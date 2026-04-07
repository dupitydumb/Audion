// Lyrics store — manages lyrics state, source selection, and sync with the player.
import { writable, derived, get } from 'svelte/store';
import { currentTrack, currentTime } from './player';
import {
    lyricsManager,
    LYRICS_SOURCES,
    type LyricLine,
    type LyricsResult,
    type LyricsFormat,
    type LyricsSource,
    type WordTiming,
} from '$lib/lyrics';
import { addToast } from '$lib/stores/toast';

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** Whether the lyrics panel is open. */
export const lyricsVisible = writable(false);

/** The currently displayed lyrics result. */
export const lyricsData = writable<LyricsResult | null>(null);

/** Fetching / switching in progress. */
export const lyricsLoading = writable(false);

/** Last fetch error message (null = no error). */
export const lyricsError = writable<string | null>(null);

/**
 * Source IDs that have a cached file for the current track.
 * 'user' and 'embedded' are virtual sources outside the registry.
 * Refreshed on every track load and after every fetch/switch.
 */
export const availableSources = writable<string[]>([]);

/**
 * The source the user has manually selected (persisted to localStorage).
 * null = "auto" .use the first available source in registry priority order.
 */
export const selectedSource = writable<string | null>(
    localStorage.getItem('lyrics_selected_source') ?? null
);

// Persist selectedSource automatically
selectedSource.subscribe(value => {
    if (value === null) {
        localStorage.removeItem('lyrics_selected_source');
    } else {
        localStorage.setItem('lyrics_selected_source', value);
    }
});

/** Index of the currently active lyric line based on playback time. */
export const activeLine = derived(
    [lyricsData, currentTime],
    ([$lyrics, $time]) => {
        if (!$lyrics || $lyrics.lines.length === 0) return -1;

        // Find the line that's currently active
        let activeIdx = -1;
        for (let i = 0; i < $lyrics.lines.length; i++) {
            if ($lyrics.lines[i].time <= $time) {
                activeIdx = i;
            } else {
                break;
            }
        }
        return activeIdx;
    }
);

// ---------------------------------------------------------------------------
// Word + Syllable sync state
// ---------------------------------------------------------------------------

/**
 * Compute active word index, word progress, active syllable index, and
 * syllable progress for a word list at a given playback time.
 *
 * used for both primary and background word lists
 */
function computeWordSyncState(
    words: WordTiming[],
    time: number,
): {
    activeWordIdx:     number;
    wordProgress:      number;
    activeSyllableIdx: number;
    syllableProgress:  number;
} {
    let activeWordIdx = -1;

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (time >= w.time && time <= w.endTime) {
            activeWordIdx = i;
            break;
        }
        if (time >= w.time) {
            const next = words[i + 1];
            if (!next || time < next.time) activeWordIdx = i;
        }
    }

    if (activeWordIdx < 0) {
        return { activeWordIdx: -1, wordProgress: 0, activeSyllableIdx: -1, syllableProgress: 0 };
    }

    const word = words[activeWordIdx];
    const wordDur = word.endTime - word.time;
    const wordProgress = wordDur > 0
        ? Math.min(100, Math.max(0, ((time - word.time) / wordDur) * 100))
        : 100;

    // ── Syllable-level tracking ─────────────────────────────────────────────
    if (!word.is_split || !word.syllables || word.syllables.length === 0) {
        return { activeWordIdx, wordProgress, activeSyllableIdx: -1, syllableProgress: 0 };
    }

    const syls = word.syllables;
    let activeSyllableIdx = -1;

    for (let i = 0; i < syls.length; i++) {
        const s = syls[i];
        if (time >= s.time && time <= s.end_time) {
            activeSyllableIdx = i;
            break;
        }
        if (time >= s.time) {
            const next = syls[i + 1];
            if (!next || time < next.time) activeSyllableIdx = i;
        }
    }

    let syllableProgress = 0;
    if (activeSyllableIdx >= 0) {
        const syl = syls[activeSyllableIdx];
        const sylDur = syl.end_time - syl.time;
        syllableProgress = sylDur > 0
            ? Math.min(100, Math.max(0, ((time - syl.time) / sylDur) * 100))
            : 100;
    }

    return { activeWordIdx, wordProgress, activeSyllableIdx, syllableProgress };
}

/**
 * Full sync state for the currently active line.
 * Tracks primary words and background words independently at word + syllable level.
 */
export const wordSyncState = derived(
    [lyricsData, currentTime, activeLine],
    ([$lyrics, $time, $activeIdx]) => {
        const empty = {
            activeWordIdx:       -1,
            wordProgress:         0,
            activeSyllableIdx:   -1,
            syllableProgress:     0,
            bgActiveWordIdx:     -1,
            bgWordProgress:       0,
            bgActiveSyllableIdx: -1,
            bgSyllableProgress:   0,
        };

        if (!$lyrics || $activeIdx < 0) return empty;
        const line = $lyrics.lines[$activeIdx];
        if (!line) return empty;

        // Primary vocal
        const primary = line.words?.length
            ? computeWordSyncState(line.words, $time)
            : { activeWordIdx: -1, wordProgress: 0, activeSyllableIdx: -1, syllableProgress: 0 };

        // Background vocal . independent tracking against the same clock
        const bg = line.background_words?.length
            ? computeWordSyncState(line.background_words, $time)
            : { activeWordIdx: -1, wordProgress: 0, activeSyllableIdx: -1, syllableProgress: 0 };

        return {
            activeWordIdx:       primary.activeWordIdx,
            wordProgress:        primary.wordProgress,
            activeSyllableIdx:   primary.activeSyllableIdx,
            syllableProgress:    primary.syllableProgress,
            bgActiveWordIdx:     bg.activeWordIdx,
            bgWordProgress:      bg.wordProgress,
            bgActiveSyllableIdx: bg.activeSyllableIdx,
            bgSyllableProgress:  bg.syllableProgress,
        };
    }
);

/**
 * The current song section label (Verse / Chorus / Bridge / …).
 * null when the active line has no structure data (LRC / TTML sources).
 */
export const activeStructure = derived(
    [lyricsData, activeLine],
    ([$lyrics, $activeIdx]) => {
        if (!$lyrics || $activeIdx < 0) return null;
        return $lyrics.lines[$activeIdx]?.structure ?? null;
    }
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let currentFetchId = 0;

const SOURCE_IDS = LYRICS_SOURCES.map((s: LyricsSource) => s.id);

// ---- Tauri invoke wrappers ------------------------------------------------

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(cmd, args);
}

/** Load user-imported lyrics (any format). Returns { content, format } or null. */
async function loadUserLyrics(musicPath: string): Promise<{ content: string; format: string } | null> {
    try {
        return await invoke<{ content: string; format: string } | null>(
            'load_user_lyrics_file', { musicPath }
        );
    } catch { return null; }
}

/** Load cached source lyrics. Returns { content, format } or null. */
async function loadSourceLyrics(
    musicPath: string,
    sourceId: string,
): Promise<{ content: string; format: string } | null> {
    try {
        return await invoke<{ content: string; format: string } | null>(
            'load_source_lyrics_file', { musicPath, sourceId }
        );
    } catch { return null; }
}

/** Persist source-fetched lyrics. */
async function saveSourceLyrics(
    musicPath: string,
    sourceId: string,
    format: string,
    content: string,
): Promise<void> {
    try {
        await invoke('save_source_lyrics_file', { musicPath, sourceId, format, content });
    } catch { /* non-fatal */ }
}

/** Refresh the availableSources store from the filesystem. */
async function refreshAvailableSources(musicPath: string, isStream = false): Promise<string[]> {
    try {
        const [cached, embeddedResult] = await Promise.all([
            invoke<Array<{ source_id: string; format: string }>>(
                'get_cached_sources', { musicPath, sourceIds: SOURCE_IDS }
            ),
            isStream
                ? Promise.resolve(null)
                : invoke<{ content: string; synced: boolean } | null>(
                    'get_embedded_lyrics', { musicPath }
                ).catch(() => null),
        ]);
        const ids = cached.map(c => c.source_id);
        if (embeddedResult && embeddedResult.content) ids.unshift('embedded');
        availableSources.set(ids);
        return ids;
    } catch {
        availableSources.set([]);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Apple JSON types
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

/**
 * Remap a single AppleRawWord to a WordTiming-compatible object.
 * The Rust serialiser uses snake_case (end_time); WordTiming uses camelCase (endTime).
 */
function mapAppleWord(w: AppleRawWord): WordTiming {
    return {
        word:      w.word,
        time:      w.time,
        endTime:   w.end_time,
        is_split:  w.is_split,
        syllables: w.syllables,
    };
}

/** Map the Rust-serialised Apple line array to our shared LyricLine[]. */
function mapAppleLines(raw: AppleRawLine[]): LyricLine[] {
    return raw.map(l => ({
        time:             l.time,
        endTime:          l.end_time,
        text:             l.text,
        words:            l.words.map(mapAppleWord),
        structure:        l.structure      || undefined,
        opposite_turn:    l.opposite_turn  || undefined,
        is_background:    l.is_background  || undefined,
        background_words: l.background_words.length
            ? l.background_words.map(mapAppleWord)
            : undefined,
        background_text:  l.background_text || undefined,
    }));
}

/**
 * Re-parse a cached file into a LyricsResult.
 * Uses the source's own parse() method
 * Falls back to raw LRC parsing for the 'user' and 'embedded' virtual sources.
 * json is parsed via tauri invoke. hence the async
 */
async function reparseFromCache(
    raw: string,
    format: string,
    sourceId: string,
): Promise<LyricsResult | null> {

    // ── JSON (Apple Music syllable data) ───────────────────────────────────
    if (format === 'json') {
        try {
            const appleLines = await invoke<AppleRawLine[]>(
                'parse_apple_lyrics_json_cmd', { raw }
            );
            const lines = mapAppleLines(appleLines);
            const hasSyllableSync = lines.some(l =>
                l.words?.some(w => w.is_split && w.syllables?.length)
            );
            return {
                lines,
                source:          sourceId,
                format:          'json',
                hasWordSync:     true,
                hasSyllableSync,
                raw,
            };
        } catch {
            return null;
        }
    }

    // ── Virtual sources ────────────────────────────────────────────────────
    if (sourceId === 'user' || sourceId === 'embedded') {
        if (format === 'ttml' || format === 'xml') {
            const lines = lyricsManager.parseTTML(raw);
            return {
                lines,
                source:      sourceId,
                format:      format as LyricsFormat,
                hasWordSync: lines.some(l => l.words && l.words.length > 0),
                raw,
            };
        }
        // Default: LRC
        const lines = lyricsManager.parseLRC(raw, sourceId !== 'embedded');
        return {
            lines,
            source:      sourceId,
            format:      'lrc',
            hasWordSync: lines.some(l => l.words && l.words.length > 0),
            raw,
        };
    }

    // ── Registered source ──────────────────────────────────────────────────
    return lyricsManager.parseFromSource(sourceId, raw);
}

// ---------------------------------------------------------------------------
// Public: fetch lyrics for the current track
// ---------------------------------------------------------------------------

export async function fetchLyricsForTrack(): Promise<void> {
    const track = get(currentTrack);
    if (!track) { lyricsData.set(null); return; }
    const isStream = !!track.source_type;

    const fetchId = ++currentFetchId;
    lyricsLoading.set(true);
    lyricsError.set(null);

    try {
        // 1. User-imported file (any format)  always wins, never overridden
        const userFile = await loadUserLyrics(track.path);
        if (userFile && fetchId === currentFetchId) {
            const result = await reparseFromCache(userFile.content, userFile.format, 'user');
            if (result) {
                lyricsData.set(result);
                await refreshAvailableSources(track.path, isStream);
                lyricsLoading.set(false);
                return;
            }
        }

        // 2. Embedded tag lyrics (SYLT preferred, then USLT)  local files only
        if (track.path && !track.source_type) {
            try {
                const embedded = await invoke<{ content: string; synced: boolean } | null>(
                    'get_embedded_lyrics', { musicPath: track.path }
                );
                if (embedded && fetchId === currentFetchId) {
                    let lines;
                    if (embedded.synced) {
                        // LRC-formatted content (native USLT-LRC or SYLT converted to LRC)
                        // Word sync disabled  SYLT is line-level only
                        lines = lyricsManager.parseLRC(embedded.content, false);
                    } else {
                        // Plain prose .render as static lines anchored at t=0
                        lines = embedded.content
                            .split('\n')
                            .map((l: string) => l.trim())
                            .filter((l: string) => l.length > 0)
                            .map((text: string) => ({ time: 0, text }));
                    }

                    if (lines.length > 0) {
                        lyricsData.set({
                            lines,
                            source:      'embedded',
                            format:      'lrc',
                            hasWordSync: false,
                            raw:         embedded.content,
                            synced:      embedded.synced,
                        });
                        await refreshAvailableSources(track.path, isStream);
                        lyricsLoading.set(false);
                        return;
                    }
                    // lines empty (e.g. malformed content) . fall through to API sources
                }
            } catch { /* tag read failed . continue */ }
        }

        // 3. Respect user's source preference if set
        const preferred = get(selectedSource);
        if (preferred && SOURCE_IDS.includes(preferred)) {
            const cached = await loadSourceLyrics(track.path, preferred);
            if (cached && fetchId === currentFetchId) {
                const result = await reparseFromCache(cached.content, cached.format, preferred);
                if (result) {
                    lyricsData.set(result);
                    await refreshAvailableSources(track.path, isStream);
                    lyricsLoading.set(false);
                    return;
                }
            }

            // Cache miss . fetch live from preferred source
            const fetched = await lyricsManager.fetchFromSource(
                preferred, track.title, track.artist, track.album, track.duration
            );
            if (fetched && fetchId === currentFetchId) {
                await saveSourceLyrics(track.path, preferred, fetched.format, fetched.raw);
                lyricsData.set(fetched);
                await refreshAvailableSources(track.path, isStream);
                lyricsLoading.set(false);
                return;
            }
            // Preferred source had nothing . fall through to auto
        }

        // 4. Auto mode: try each source in registry order, cache first
        for (const source of LYRICS_SOURCES) {
            const cached = await loadSourceLyrics(track.path, source.id);
            if (cached) {
                if (fetchId !== currentFetchId) return;
                const result = await reparseFromCache(cached.content, cached.format, source.id);
                if (result) {
                    lyricsData.set(result);
                    await refreshAvailableSources(track.path, isStream);
                    lyricsLoading.set(false);
                    return;
                }
            }

            // Not cached . fetch live
            try {
                if (fetchId !== currentFetchId) return;
                const result = await source.fetch(
                    lyricsManager.cleanTitle(track.title ?? ''),
                    (track.artist ?? 'Unknown Artist').toLowerCase(),
                    track.album,
                    track.duration,
                );
                if (result) {
                    if (fetchId !== currentFetchId) return;
                    await saveSourceLyrics(track.path, source.id, result.format, result.raw);
                    lyricsData.set(result);
                    await refreshAvailableSources(track.path, isStream);
                    lyricsLoading.set(false);
                    return;
                }
            } catch { /* try next source */ }
        }

        // Nothing found
        if (fetchId === currentFetchId) {
            lyricsData.set(null);
            lyricsError.set('No lyrics found');
            addToast('No lyrics found for this track', 'error');
            await refreshAvailableSources(track.path, isStream);
        }

    } catch {
        if (fetchId === currentFetchId) {
            lyricsError.set('Failed to fetch lyrics');
            addToast('Failed to fetch lyrics', 'error');
        }
    } finally {
        if (fetchId === currentFetchId) lyricsLoading.set(false);
    }
}

// ---------------------------------------------------------------------------
// Public: switch to a specific source (from the dropdown)
// ---------------------------------------------------------------------------

export async function switchLyricsSource(sourceId: string): Promise<void> {
    const track = get(currentTrack);
    if (!track) return;

    const previousSource = get(selectedSource);
    const label = LYRICS_SOURCES.find((s: LyricsSource) => s.id === sourceId)?.label ?? sourceId;

    // Clear immediately
    lyricsData.set(null);
    lyricsError.set(null);
    lyricsLoading.set(true);

    // Set optimistically so fetchLyricsForTrack respects it if the user
    // switches tracks mid-flight. Reverted below on any failure.
    selectedSource.set(sourceId);

    const fetchId = ++currentFetchId;

    const revert = (errorMsg: string) => {
        if (fetchId !== currentFetchId) return;
        selectedSource.set(previousSource);
        lyricsError.set(errorMsg);
        addToast(errorMsg, 'error');
    };

    try {
        if (sourceId === 'embedded') {
            try {
                const embedded = await invoke<{ content: string; synced: boolean } | null>(
                    'get_embedded_lyrics', { musicPath: track.path }
                );
                if (!embedded || !embedded.content) {
                    revert('No embedded lyrics found');
                    return;
                }
                if (fetchId !== currentFetchId) return;
                let lines;
                if (embedded.synced) {
                    lines = lyricsManager.parseLRC(embedded.content, false);
                } else {
                    lines = embedded.content
                        .split('\n')
                        .map((l: string) => l.trim())
                        .filter((l: string) => l.length > 0)
                        .map((text: string) => ({ time: 0, text }));
                }
                if (lines.length === 0) {
                    revert('No embedded lyrics found');
                    return;
                }
                // Determine format for the badge
                const format: LyricsFormat = 'lrc';
                lyricsData.set({
                    lines,
                    source:      'embedded',
                    format,
                    hasWordSync: false,
                    raw:         embedded.content,
                    synced:      embedded.synced,
                });
                addToast('Switched to Embedded', 'success');
                lyricsLoading.set(false);
                return;
            } catch {
                revert('Failed to read embedded lyrics');
                return;
            }
        }
        // Try cache first
        const cached = await loadSourceLyrics(track.path, sourceId);
        if (cached && fetchId === currentFetchId) {
            const result = await reparseFromCache(cached.content, cached.format, sourceId);
            if (result) {
                lyricsData.set(result);
                addToast(`Switched to ${label}`, 'success');
                lyricsLoading.set(false);
                return;
            }
        }

        // Cache miss . fetch live
        if (fetchId !== currentFetchId) return;
        const result = await lyricsManager.fetchFromSource(
            sourceId, track.title, track.artist, track.album, track.duration
        );
        if (fetchId !== currentFetchId) return;

        if (result) {
            await saveSourceLyrics(track.path, sourceId, result.format, result.raw);
            lyricsData.set(result);
            await refreshAvailableSources(track.path);
            addToast(`Switched to ${label}`, 'success');
        } else {
            revert(`No lyrics found on ${label}`);
        }
    } catch {
        revert(`Failed to fetch lyrics from ${label}`);
    } finally {
        if (fetchId === currentFetchId) lyricsLoading.set(false);
    }
}

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------

export function toggleLyrics(): void {
    lyricsVisible.update(v => !v);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let _unsubscribe: (() => void) | null = null;

export function initLyricsSync(): void {
    if (_unsubscribe) return;

    _unsubscribe = currentTrack.subscribe(track => {
        if (track) {
            fetchLyricsForTrack();
        } else {
            lyricsData.set(null);
            lyricsError.set(null);
            availableSources.set([]);
        }
    });
}

export function destroyLyricsSync(): void {
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}

// ---------------------------------------------------------------------------
// Public: import a lyrics file for the current track
// ---------------------------------------------------------------------------

export async function importLyricsContent(content: string, format: 'lrc' | 'ttml' | 'srt' | 'json'): Promise<void> {
    const track = get(currentTrack);
    if (!track) {
        addToast('No track selected for lyrics import.', 'error');
        return;
    }

    // Validate before saving.
    // JSON (Apple Music) is validated by the Rust parser via Tauri invoke 
    // we do a dry-run parse here so the user gets an error before anything is saved.
    try {
        if (format === 'json') {
            const testLines = await invoke<unknown[]>('parse_apple_lyrics_json_cmd', { raw: content });
            if (!testLines || testLines.length === 0) {
                addToast('No lyric lines found in the JSON file.', 'error');
                return;
            }
        } else {
            const testLines = format === 'ttml'
                ? lyricsManager.parseTTML(content)
                : format === 'srt'
                ? lyricsManager.parseSRT(content)
                : lyricsManager.parseLRC(content);
            if (testLines.length === 0) {
                addToast(`No lyric lines found in the ${format.toUpperCase()} file.`, 'error');
                return;
            }
        }
    } catch {
        addToast(`Failed to parse the ${format.toUpperCase()} file.`, 'error');
        return;
    }

    try {
        await invoke('save_user_lyrics_file', {
            musicPath: track.path,
            format,
            content,
        });
        lyricsData.set(null);
        lyricsLoading.set(true);
        await fetchLyricsForTrack();
        addToast('Lyrics imported successfully!', 'success');
    } catch {
        addToast('Failed to save imported lyrics.', 'error');
    }
}

// ---------------------------------------------------------------------------
// lyricsStore . utility object for external callers
// ---------------------------------------------------------------------------

export const lyricsStore = {
    clearLyrics(): void {
        lyricsData.set(null);
        lyricsError.set(null);
        lyricsLoading.set(false);
    },

    /** Delete the user-imported lyrics for the current track and reload. */
    async clearCurrentTrackCache(): Promise<void> {
        const track = get(currentTrack);
        if (!track) return;
        try {
            await invoke('delete_user_lyrics_file', { musicPath: track.path });
        } catch { /* non-fatal */ }
        lyricsData.set(null);
        lyricsError.set(null);
        await refreshAvailableSources(track.path);
        await fetchLyricsForTrack();
    },

    /** Delete the cached lyrics for a specific source on the current track. */
    async clearSourceCache(sourceId: string): Promise<void> {
        const track = get(currentTrack);
        if (!track) return;
        try {
            await invoke('delete_source_lyrics_file', { musicPath: track.path, sourceId });
        } catch { /* non-fatal */ }
        await refreshAvailableSources(track.path);
        if (get(lyricsData)?.source === sourceId) {
            lyricsData.set(null);
            await fetchLyricsForTrack();
        }
    },
};

// ---------------------------------------------------------------------------
// Public API (plugin / integration use)
// ---------------------------------------------------------------------------

export async function getLyrics(musicPath: string): Promise<LyricLine[] | null> {
    try {
        return await invoke<LyricLine[] | null>('get_lyrics', { musicPath });
    } catch { return null; }
}

export async function getCurrentLyric(
    musicPath: string,
    time: number,
): Promise<{ line: LyricLine; index: number } | null> {
    try {
        const result = await invoke<{
            index: number; time: number; text: string; words?: LyricLine['words']
        } | null>('get_current_lyric', { musicPath, currentTime: time });
        if (!result) return null;

        return {
            index: result.index,
            line: {
                time: result.time,
                text: result.text,
                words: result.words
            }
        };
    } catch { return null; }
}

export async function getCurrentTrackLyrics(): Promise<LyricLine[] | null> {
    const track = get(currentTrack);
    if (!track) return null;

    return getLyrics(track.path);
}

export async function getCurrentTrackActiveLyric(): Promise<{ line: LyricLine; index: number } | null> {
    const track = get(currentTrack);
    const time = get(currentTime);

    if (!track) return null;

    return getCurrentLyric(track.path, time);
}
