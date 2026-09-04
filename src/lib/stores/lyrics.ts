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
 * lyrics rendering mode (persisted to localStorage)
 * legacy: original alignment rules
 * opposite_turn lines right aligned everything else left aligned
 * 
 * dynamic: structure aware alignment
 * see lyricsAlignment below
 * default is dynamic
 */
export type LyricsRenderMode = 'legacy' | 'dynamic';

export const lyricsRenderMode = writable<LyricsRenderMode>(
    (localStorage.getItem('lyrics_render_mode') as LyricsRenderMode | null) ?? 'dynamic'
);

lyricsRenderMode.subscribe(value => {
    localStorage.setItem('lyrics_render_mode', value);
});

/**
 * per line horizontal alignment for dynamic mode
 *
 * block = a run of consecutive lines sharing one structure value
 * that is, everything under one separator up to the next one
 * block where every line is opposite_turn  => block: right
 * block that is all normal (no opposite_turn lines)
 * and is immediately followed by a pure opposite block => block: left
 * any other all normal block => block: center
 * mixed block (some opposite_turn, some not) =>
 * each opposite_turn line: right; each normal line: left
 * section labels are always centered
 */
export type LineAlign = 'left' | 'center' | 'right';

export interface LyricsAlignment {
    /** alignment for each line, by index*/
    line: LineAlign[];
}

const EMPTY_ALIGNMENT: LyricsAlignment = { line: [] };

export const lyricsAlignment = derived(lyricsData, ($lyrics): LyricsAlignment => {
    if (!$lyrics || $lyrics.lines.length === 0) return EMPTY_ALIGNMENT;
    const lines = $lyrics.lines;

    // locate every block's start index in one linear pass
    const blockStarts: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (i === 0 || lines[i].structure !== lines[i - 1].structure) blockStarts.push(i);
    }

    const line: LineAlign[] = new Array(lines.length);

    for (let b = 0; b < blockStarts.length; b++) {
        const start = blockStarts[b];
        const end   = b + 1 < blockStarts.length ? blockStarts[b + 1] : lines.length;

        let pureOppo = true;
        let pureNormal = true;
        for (let k = start; k < end; k++) {
            if (lines[k].opposite_turn) pureNormal = false; else pureOppo = false;
        }
        const isMixed = !pureOppo && !pureNormal;

        let nextIsPureOppo = false;
        if (end < lines.length) {
            const nextEnd = b + 2 < blockStarts.length ? blockStarts[b + 2] : lines.length;
            nextIsPureOppo = true;
            for (let k = end; k < nextEnd; k++) {
                if (!lines[k].opposite_turn) { nextIsPureOppo = false; break; }
            }
        }

        const blockAlign: LineAlign = pureOppo ? 'right' : (nextIsPureOppo ? 'left' : 'center');

        for (let k = start; k < end; k++) {
            if (isMixed) {
                line[k] = lines[k].opposite_turn ? 'right' : 'left';
            } else {
                line[k] = blockAlign;
            }
        }
    }

    return { line };
});

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

/**
 * auto mode source priority, e.g. user/embedded/applejson
 * controls the order fetchLyricsForTrack walks sources in auto mode only
 * manual selection (dropdown / fetchFromSpecificSource) is unaffected
 * a source left out of this list simply isn't auto tried; it's still pickable manually
 *
 * raw string is persisted as-is
 * resolved ids are derived on read
 * so this always reflects whatever is currently registered (no hardcoded alias
 * table => valid ids are user, embedded, plus whatever SOURCE_IDS holds)
 */
export const sourcePriorityRaw = writable<string>(
    localStorage.getItem('lyrics_source_priority') ?? ''
);

/** lowercase letters and single "/" separators only; no leading/trailing/double slashes, no spaces */
const PRIORITY_FORMAT_RE = /^[a-z]+(\/[a-z]+)*$/;

function knownPriorityIds(): string[] {
    return ['user', 'embedded', ...SOURCE_IDS];
}

/**
 * validate and persist a raw priority string
 * rejects (leaves the previous config untouched) on malformed input or any token not matching a currently known source id
 * returns true if accepted, false if rejected
 */
export function setSourcePriority(raw: string): boolean {
    if (raw === '') {
        sourcePriorityRaw.set('');
        localStorage.removeItem('lyrics_source_priority');
        return true;
    }

    if (!PRIORITY_FORMAT_RE.test(raw)) return false;

    const tokens = raw.split('/');
    const known = new Set(knownPriorityIds());
    if (!tokens.every(t => known.has(t))) return false;

    sourcePriorityRaw.set(raw);
    localStorage.setItem('lyrics_source_priority', raw);
    return true;
}

/**
 * resolved, ordered list of source ids to try in auto mode
 * falls back to the default order (user, embedded, then registry order) when no priority is configured
 */
export function getSourcePriorityIds(): string[] {
    const raw = get(sourcePriorityRaw);
    if (!raw) return ['user', 'embedded', ...SOURCE_IDS];

    // revalidate against currently known ids in case a source was removed since this was saved
    // drop stale tokens rather than failing
    const known = new Set(knownPriorityIds());
    const resolved = raw.split('/').filter(t => known.has(t));
    return resolved.length > 0 ? resolved : ['user', 'embedded', ...SOURCE_IDS];
}

/**
 * indices of every lyric line whose window currently contains playback time
 * lines can overlap, so this can hold more than one index at once
 *
 * falls back to the single most recently started line during gaps between phrases
 * so something is always highlighted
 */
export const activeLines = derived(
    [lyricsData, currentTime],
    ([$lyrics, $time]) => {
        if (!$lyrics || $lyrics.lines.length === 0) return [];

        const containing: number[] = [];
        let lastStarted = -1;
        for (let i = 0; i < $lyrics.lines.length; i++) {
            const line = $lyrics.lines[i];
            if (line.time <= $time) {
                lastStarted = i;
                // when missing, fall back to "ends where the next line starts"
                // (or never, for the last line)
                const effectiveEnd = line.endTime ?? $lyrics.lines[i + 1]?.time ?? Infinity;
                if ($time < effectiveEnd) containing.push(i);
            } else {
                break;
            }
        }
        return containing.length > 0 ? containing : (lastStarted >= 0 ? [lastStarted] : []);
    }
);

/**
 * primary active line
 * the earliest started line still in activeLines
 * used for auto scroll target and the section label lookup
 */
export const activeLine = derived(
    activeLines,
    ($lines) => $lines.length > 0 ? $lines[0] : -1
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

export interface LineSyncState {
    activeWordIdx:       number;
    wordProgress:        number;
    activeSyllableIdx:   number;
    syllableProgress:    number;
    bgActiveWordIdx:     number;
    bgWordProgress:      number;
    bgActiveSyllableIdx: number;
    bgSyllableProgress:  number;
}

const EMPTY_LINE_SYNC_STATE: LineSyncState = {
    activeWordIdx:       -1,
    wordProgress:         0,
    activeSyllableIdx:   -1,
    syllableProgress:     0,
    bgActiveWordIdx:     -1,
    bgWordProgress:       0,
    bgActiveSyllableIdx: -1,
    bgSyllableProgress:   0,
};

/**
 * full sync state for every currently active line
 * (see activeLines)
 * keyed by line index
 * each line tracks its primary words and background words independently at word + syllable level
 * so multiple lines can be mid fill simultaneously
 */
export const wordSyncState = derived(
    [lyricsData, currentTime, activeLines],
    ([$lyrics, $time, $activeIdxs]) => {
        const result = new Map<number, LineSyncState>();
        if (!$lyrics || $activeIdxs.length === 0) return result;

        for (const idx of $activeIdxs) {
            const line = $lyrics.lines[idx];
            if (!line) continue;

            const primary = line.words?.length
                ? computeWordSyncState(line.words, $time)
                : { activeWordIdx: -1, wordProgress: 0, activeSyllableIdx: -1, syllableProgress: 0 };

            const bg = line.background_words?.length
                ? computeWordSyncState(line.background_words, $time)
                : { activeWordIdx: -1, wordProgress: 0, activeSyllableIdx: -1, syllableProgress: 0 };

            result.set(idx, {
                activeWordIdx:       primary.activeWordIdx,
                wordProgress:        primary.wordProgress,
                activeSyllableIdx:   primary.activeSyllableIdx,
                syllableProgress:    primary.syllableProgress,
                bgActiveWordIdx:     bg.activeWordIdx,
                bgWordProgress:      bg.wordProgress,
                bgActiveSyllableIdx: bg.activeSyllableIdx,
                bgSyllableProgress:  bg.syllableProgress,
            });
        }
        return result;
    }
);

/** sync state for a given line index, or a safe empty state */
export function getLineSyncState(
    map: Map<number, LineSyncState>,
    idx: number,
): LineSyncState {
    return map.get(idx) ?? EMPTY_LINE_SYNC_STATE;
}

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

// ---------------------------------------------------------------------------
// Genius JSON types
// ---------------------------------------------------------------------------

interface GeniusRawLine {
    time:            number;
    end_time:        number;
    text:            string;
    structure:       string;
    opposite_turn:   boolean;
    is_background:   boolean;
    background_text: string;
}

/** map the rust Genius line array to our shared LyricLine */
function mapGeniusLines(raw: GeniusRawLine[]): LyricLine[] {
    return raw.map(l => ({
        time:            l.time,
        endTime:         l.end_time,
        text:            l.text,
        structure:       l.structure       || undefined,
        opposite_turn:   l.opposite_turn   || undefined,
        is_background:   l.is_background   || undefined,
        background_text: l.background_text || undefined,
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

    // ── JSON: route to the correct rust parser by sourceId ─────────────────
    if (format === 'json') {
        // ── Apple Music syllable JSON ───────────────────────────────────────
        if (sourceId === 'applejson') {
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

        // ── Genius plain-text JSON ──────────────────────────────────────────
        if (sourceId === 'genius') {
            try {
                const geniusLines = await invoke<GeniusRawLine[]>(
                    'parse_genius_lyrics_json_cmd', { raw }
                );
                const lines = mapGeniusLines(geniusLines);
                return {
                    lines,
                    source:          sourceId,
                    format:          'json',
                    hasWordSync:     false,
                    hasSyllableSync: false,
                    raw,
                };
            } catch {
                return null;
            }
        }

        // Unknown JSON source .bail out
        return null;
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

/**
 * try to load (from cache) or fetch (live) lyrics for one source id
 * handles the three shapes a source can be: user (imported file)
 * embedded (audio tag, local files only), or a registered api source
 * returns null on any miss/failure so the caller can move to the next id
 */
/**
 * per-invocation query override
 * searched as is
 * 
 * template substitution (e.g. resolving $title / $artist tokens typed by the user into real metadata) happens in lyricspanel.svelte
 * this just takes the final resolved strings
 */
export interface LyricsQueryOverride {
    title?: string;
    artist?: string;
    album?: string | null;
    duration?: number | null;
}

async function tryLoadOrFetchSource(
    sourceId: string,
    track: { path: string; title?: string | null; artist?: string | null; album?: string | null; duration?: number | null; source_type?: string | null },
    fetchId: number,
    isStream: boolean,
    override?: LyricsQueryOverride,
): Promise<LyricsResult | null> {
    if (sourceId === 'user') {
        // file based, not query based 
        // skip it on a manual-query retry (already tried once in 1)
        if (override) return null;
        const userFile = await loadUserLyrics(track.path);
        if (!userFile || fetchId !== currentFetchId) return null;
        return await reparseFromCache(userFile.content, userFile.format, 'user');
    }

    if (sourceId === 'embedded') {
        if (override) return null; // same reasoning as user above
        if (!track.path || track.source_type) return null; // local files only
        try {
            const embedded = await invoke<{ content: string; synced: boolean } | null>(
                'get_embedded_lyrics', { musicPath: track.path }
            );
            if (!embedded || fetchId !== currentFetchId) return null;

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
            if (lines.length === 0) return null; // malformed content . fall through

            return {
                lines,
                source:      'embedded',
                format:      'lrc',
                hasWordSync: false,
                raw:         embedded.content,
                synced:      embedded.synced,
            };
        } catch {
            return null; // tag read failed . continue
        }
    }

    // registered source =========================================
    if (!SOURCE_IDS.includes(sourceId)) return null;

    // custom query retry should never surface a cached result from the previous (default) query
    if (!override) {
        const cached = await loadSourceLyrics(track.path, sourceId);
        if (cached && fetchId === currentFetchId) {
            const result = await reparseFromCache(cached.content, cached.format, sourceId);
            if (result) return result;
        }
    }

    if (fetchId !== currentFetchId) return null;
    try {
        const source = override ? LYRICS_SOURCES.find((s: LyricsSource) => s.id === sourceId) : null;
        const result = override && source
            ? await source.fetch(
                override.title  ?? track.title  ?? '',
                override.artist ?? track.artist ?? '',
                override.album !== undefined    ? override.album    : track.album,
                override.duration !== undefined ? override.duration : track.duration,
              )
            : await lyricsManager.fetchFromSource(
                sourceId, track.title ?? null, track.artist ?? null, track.album, track.duration
              );
        if (result && fetchId === currentFetchId) {
            await saveSourceLyrics(track.path, sourceId, result.format, result.raw);
            return result;
        }
    } catch { /* try next source */ }

    return null;
}

/**
 * rerun lyrics resolution for the current track
 *
 * with no override: normal flow => manual selectedSource preference first
 * (if set), then the configured auto-mode priority chain
 *
 * With an override: skips the selectedSource preference
 * and walks the entire priority chain fresh using the override's query,
 * bypassing cache and cleanTitle/lowercasing for every searchable source
 *  user/embedded are skipped
 */
export async function fetchLyricsForTrack(override?: LyricsQueryOverride): Promise<void> {
    const track = get(currentTrack);
    if (!track) { lyricsData.set(null); return; }
    const isStream = !!track.source_type;

    const fetchId = ++currentFetchId;
    lyricsLoading.set(true);
    lyricsError.set(null);

    try {
        // 1. respect user's manual source preference if set 
        // (manual override always takes priority over the auto walk, regardless of the configured priority list)
        // skipped entirely on a query retry
        if (!override) {
            const preferred = get(selectedSource);
            if (preferred) {
                const result = await tryLoadOrFetchSource(preferred, track, fetchId, isStream);
                if (result && fetchId === currentFetchId) {
                    lyricsData.set(result);
                    await refreshAvailableSources(track.path, isStream);
                    lyricsLoading.set(false);
                    return;
                }
                // preferred source had nothing . fall through to auto
            }
        }

        // 2. auto mode: walk the configured priority list (cache check then
        //    live fetch each, or straight to live fetch with override when
        //    retrying)
        // default : user -> embedded -> registry order when unconfigured
        for (const sourceId of getSourcePriorityIds()) {
            if (fetchId !== currentFetchId) return;
            const result = await tryLoadOrFetchSource(sourceId, track, fetchId, isStream, override);
            if (result && fetchId === currentFetchId) {
                lyricsData.set(result);
                await refreshAvailableSources(track.path, isStream);
                lyricsLoading.set(false);
                return;
            }
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
// Public: switch to a specific source (from the dropdown), and manual fetch
// ---------------------------------------------------------------------------

/**
 * fetch lyrics from one specific source, with optional full control over search parameters
 * standalone core used by both the dropdown(switchLyricsSource) and any future custom query ui
 *
 * no override: behaves like a normal cache then live fetch for that source
 * (same cleanTitle/lowercasing as auto mode)
 * with override: bypasses cleanTitle/lowercasing entirely and uses the given fields as is, falling back to the current track's metadata for any field left unset
 * skipCache forces a live fetch, bypassing the cached file check
 */
export async function fetchFromSpecificSource(
    sourceId: string,
    override?: LyricsQueryOverride,
    opts?: { skipCache?: boolean },
): Promise<LyricsResult | null> {
    const track = get(currentTrack);
    if (!track) return null;

    if (sourceId === 'user') {
        const userFile = await loadUserLyrics(track.path);
        if (!userFile) return null;
        return await reparseFromCache(userFile.content, userFile.format, 'user');
    }

    if (sourceId === 'embedded') {
        if (!track.path || track.source_type) return null; // local files only
        try {
            const embedded = await invoke<{ content: string; synced: boolean } | null>(
                'get_embedded_lyrics', { musicPath: track.path }
            );
            if (!embedded || !embedded.content) return null;

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
            if (lines.length === 0) return null;

            return {
                lines,
                source:      'embedded',
                format:      'lrc',
                hasWordSync: false,
                raw:         embedded.content,
                synced:      embedded.synced,
            };
        } catch {
            return null;
        }
    }

    // registered source =========================================
    const source = LYRICS_SOURCES.find((s: LyricsSource) => s.id === sourceId);
    if (!source) return null;

    if (!opts?.skipCache) {
        const cached = await loadSourceLyrics(track.path, sourceId);
        if (cached) {
            const result = await reparseFromCache(cached.content, cached.format, sourceId);
            if (result) return result;
        }
    }

    try {
        let result: LyricsResult | null;
        if (override) {
            // fully manual
            result = await source.fetch(
                override.title  ?? track.title  ?? '',
                override.artist ?? track.artist ?? '',
                override.album !== undefined    ? override.album    : track.album,
                override.duration !== undefined ? override.duration : track.duration,
            );
        } else {
            result = await lyricsManager.fetchFromSource(
                sourceId, track.title ?? null, track.artist ?? null, track.album, track.duration
            );
        }
        if (result) {
            await saveSourceLyrics(track.path, sourceId, result.format, result.raw);
        }
        return result;
    } catch (err) {
        console.warn(`[lyrics store] fetchFromSpecificSource error (${sourceId}):`, err);
        return null;
    }
}

export async function switchLyricsSource(sourceId: string): Promise<void> {
    const track = get(currentTrack);
    if (!track) return;

    const previousSource = get(selectedSource);
    const label =
        sourceId === 'user'     ? 'Imported' :
        sourceId === 'embedded' ? 'Embedded' :
        LYRICS_SOURCES.find((s: LyricsSource) => s.id === sourceId)?.label ?? sourceId;

    // clear immediately
    lyricsData.set(null);
    lyricsError.set(null);
    lyricsLoading.set(true);

    // set optimistically so fetchLyricsForTrack respects it if the user switches tracks mid flight
    // reverted below on any failure
    selectedSource.set(sourceId);

    const fetchId = ++currentFetchId;

    try {
        const result = await fetchFromSpecificSource(sourceId);
        if (fetchId !== currentFetchId) return;

        if (result) {
            lyricsData.set(result);
            await refreshAvailableSources(track.path, !!track.source_type);
            addToast(`Switched to ${label}`, 'success');
        } else {
            selectedSource.set(previousSource);
            const msg = `No lyrics found on ${label}`;
            lyricsError.set(msg);
            addToast(msg, 'error');
        }
    } catch {
        selectedSource.set(previousSource);
        const msg = `Failed to fetch lyrics from ${label}`;
        lyricsError.set(msg);
        addToast(msg, 'error');
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
        await refreshAvailableSources(track.path, !!track.source_type);
        await fetchLyricsForTrack();
    },

    /** Delete the cached lyrics for a specific source on the current track. */
    async clearSourceCache(sourceId: string): Promise<void> {
        const track = get(currentTrack);
        if (!track) return;
        try {
            await invoke('delete_source_lyrics_file', { musicPath: track.path, sourceId });
        } catch { /* non-fatal */ }
        await refreshAvailableSources(track.path, !!track.source_type);
        if (get(lyricsData)?.source === sourceId) {
            lyricsData.set(null);
            await fetchLyricsForTrack();
        }
    },

    /**
     * delete the lyrics file for a given source on the current track
     * unified dispatcher
     * user (imported) and embedded are handled specially
     * since they don't go through the registered source file naming scheme
     * embedded can't be deleted (it lives in the audio file itself)
     * returns true if a delete was attempted (and not rejected outright)
     * false for unknown/embedded ids
     */
    async deleteLyricsForSource(sourceId: string): Promise<boolean> {
        const track = get(currentTrack);
        if (!track) return false;

        if (sourceId === 'embedded') {
            // embedded lyrics live inside the audio file itself; not deletable
            return false;
        }

        if (sourceId === 'user') {
            await this.clearCurrentTrackCache();
            return true;
        }

        if (!SOURCE_IDS.includes(sourceId)) return false;

        await this.clearSourceCache(sourceId);
        return true;
    },

    /**
     * delete every cached lyrics file for the current track across all sources (registered sources + imported)
     * embedded is skipped since it can't be deleted
     * reloads lyrics afterward
     */
    async clearAllLyricsForTrack(): Promise<void> {
        const track = get(currentTrack);
        if (!track) return;
        const isStream = !!track.source_type;

        // get_cached_sources only reports registered api sources
        // so user is deleted separately (it's a virtual source outside the registry)
        const cachedIds = await refreshAvailableSources(track.path, isStream);
        const idsToDelete = new Set<string>(cachedIds.filter(id => id !== 'embedded'));
        idsToDelete.add('user');

        const results = await Promise.allSettled(
            Array.from(idsToDelete).map(id =>
                id === 'user'
                    ? invoke('delete_user_lyrics_file', { musicPath: track.path })
                    : invoke('delete_source_lyrics_file', { musicPath: track.path, sourceId: id })
            )
        );
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.error(
                `[Lyrics] Failed to delete ${failed.length} of ${results.length} cached lyrics files:`,
                failed,
            );
            addToast(`Failed to delete ${failed.length} cached lyrics file${failed.length === 1 ? '' : 's'}`, 'error');
        }

        lyricsData.set(null);
        lyricsError.set(null);
        await refreshAvailableSources(track.path, isStream);
        await fetchLyricsForTrack();
    },

    /**
     * bulk delete every cached lyrics file matching token across the entire library (Settings => Lyrics => Delete all <token> lyrics)
     * token is compared purely by filename pattern on the backend
     * user matches imported files, all matches every source
     * never needs updating when a new source is added
     * returns the number of files deleted
     */
    async deleteLyricsByToken(token: string): Promise<number> {
        const normalized = token.trim().toLowerCase();
        if (!normalized) return 0;
        try {
            return await invoke<number>('delete_lyrics_by_token', { token: normalized });
        } catch (err) {
            console.warn('[lyrics store] deleteLyricsByToken failed:', err);
            throw err;
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
