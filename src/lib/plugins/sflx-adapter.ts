// Community (.sflx) Extension Compatibility Bridge
// Adapts .sflx stream/lyrics/metadata extensions to Audion's typed provider interfaces

import type {
    StreamProvider,
    StreamSourceResult,
    MetadataProvider,
    MetadataSearchResult,
    MetadataTrackItem,
    LyricsProvider,
    LyricsProviderResult
} from './providers';
import { proxyFetch } from '../network';

export interface SflxManifest {
    id: string;
    name: string;
    version: string;
    author: string;
    description?: string;
    type: 'stream' | 'lyrics' | 'metadata' | 'all';
    main?: string;
    permissions?: string[];
}

export interface SflxRawTrack {
    id: string | number;
    title?: string;
    name?: string;
    artist?: string;
    artists?: string[] | Array<{ name: string }>;
    album?: string | { name: string };
    duration?: number;
    pic?: string;
    cover?: string;
    cover_url?: string;
    url?: string;
    [key: string]: any;
}

export interface SflxAdapterResult {
    manifest: SflxManifest;
    streamProvider?: StreamProvider;
    metadataProvider?: MetadataProvider;
    lyricsProvider?: LyricsProvider;
}

/**
 * Parses an LRC string into Audion's structured lyric lines.
 */
function parseLrc(lrcText: string): Array<{ time: number; text: string }> {
    const lines = lrcText.split(/\r?\n/);
    const result: Array<{ time: number; text: string }> = [];
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

    for (const rawLine of lines) {
        timeRegex.lastIndex = 0;
        const matches: number[] = [];
        let match: RegExpExecArray | null;

        while ((match = timeRegex.exec(rawLine)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
            matches.push(minutes * 60 + seconds + millis / 1000);
        }

        const text = rawLine.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
        for (const t of matches) {
            result.push({ time: t, text });
        }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
}

/**
 * Executes an .sflx extension script inside a controlled environment
 * and maps its exports to Audion's provider interfaces.
 */
export function createSflxExtensionAdapter(
    scriptContent: string,
    rawManifest: Partial<SflxManifest>,
    envOverrides?: {
        storage?: { get: (k: string) => any; set: (k: string, v: any) => void };
        fetchFn?: (url: string, opts?: any) => Promise<any>;
    }
): SflxAdapterResult {
    const manifest: SflxManifest = {
        id: rawManifest.id || `sflx-${Date.now()}`,
        name: rawManifest.name || 'Community Extension',
        version: rawManifest.version || '1.0.0',
        author: rawManifest.author || 'Unknown',
        description: rawManifest.description || '',
        type: rawManifest.type || 'all',
        main: rawManifest.main || 'index.js',
    };

    // Shared storage shim
    const localStore: Record<string, any> = {};
    const storageShim = envOverrides?.storage || {
        get: (key: string) => localStore[key] ?? null,
        set: (key: string, val: any) => { localStore[key] = val; },
        remove: (key: string) => { delete localStore[key]; },
    };

    // Shared $fetch shim (uses proxyFetch or native fetch)
    const fetchShim = envOverrides?.fetchFn || (async (url: string, opts?: any) => {
        try {
            return await proxyFetch<any>(url, opts);
        } catch {
            const res = await fetch(url, opts);
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        }
    });

    // Modules container
    const moduleExports: Record<string, any> = {};
    const moduleObj = { exports: moduleExports };

    // Sandbox execution context
    const sandboxScope = {
        module: moduleObj,
        exports: moduleExports,
        $fetch: fetchShim,
        fetch: fetchShim,
        storage: storageShim,
        console: {
            log: (...args: any[]) => console.log(`[Sflx:${manifest.id}]`, ...args),
            warn: (...args: any[]) => console.warn(`[Sflx:${manifest.id}]`, ...args),
            error: (...args: any[]) => console.error(`[Sflx:${manifest.id}]`, ...args),
        },
    };

    try {
        const paramNames = Object.keys(sandboxScope);
        const paramValues = Object.values(sandboxScope);
        const runner = new Function(...paramNames, `${scriptContent}\n;return module.exports;`);
        const executedExports = runner(...paramValues) || moduleExports;

        const result: SflxAdapterResult = { manifest };

        // 1. Check for Stream capability
        const getStreamFn = executedExports.getMediaSource || executedExports.getStream || executedExports.resolveStream;
        if (typeof getStreamFn === 'function') {
            result.streamProvider = {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                getStream: async (songId: string, quality?: string): Promise<StreamSourceResult | string | null> => {
                    const res = await getStreamFn(songId, quality);
                    if (!res) return null;
                    if (typeof res === 'string') return { url: res };
                    return {
                        url: res.url,
                        format: res.format,
                        bitrate: res.bitrate,
                        headers: res.headers,
                    };
                },
            };
        }

        // 2. Check for Search / Metadata capability
        const searchFn = executedExports.search;
        if (typeof searchFn === 'function') {
            result.metadataProvider = {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                search: async (query: string, type: 'all' | 'track' | 'album' | 'artist' = 'all', page: number = 1): Promise<MetadataSearchResult> => {
                    const rawResults = await searchFn(query, page, type);
                    const tracks: MetadataTrackItem[] = [];

                    const list = Array.isArray(rawResults)
                        ? rawResults
                        : rawResults?.tracks || rawResults?.songs || rawResults?.data || [];

                    for (const item of list) {
                        let artistStr = 'Unknown Artist';
                        if (typeof item.artist === 'string') {
                            artistStr = item.artist;
                        } else if (Array.isArray(item.artists)) {
                            artistStr = item.artists
                                .map((a: any) => typeof a === 'string' ? a : a.name)
                                .filter(Boolean)
                                .join(', ');
                        }

                        tracks.push({
                            id: String(item.id || item.songId || item.mid || ''),
                            title: String(item.title || item.name || 'Unknown Title'),
                            artist: artistStr,
                            album: typeof item.album === 'string' ? item.album : item.album?.name,
                            duration: item.duration || item.interval,
                            cover_url: item.cover_url || item.pic || item.cover,
                            source_type: manifest.id,
                            bitrate: item.bitrate,
                            format: item.format,
                        });
                    }

                    return { tracks };
                },
                getTrack: async (id: string): Promise<MetadataTrackItem | null> => {
                    if (typeof executedExports.getSongInfo === 'function') {
                        const item = await executedExports.getSongInfo(id);
                        if (!item) return null;
                        return {
                            id: String(item.id || id),
                            title: String(item.title || item.name || ''),
                            artist: String(item.artist || 'Unknown Artist'),
                            album: typeof item.album === 'string' ? item.album : item.album?.name,
                            duration: item.duration,
                            cover_url: item.cover_url || item.pic,
                        };
                    }
                    return null;
                },
            };
        }

        // 3. Check for Lyrics capability
        const getLyricFn = executedExports.getLyric || executedExports.getLyrics;
        if (typeof getLyricFn === 'function') {
            result.lyricsProvider = {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                getLyrics: async (track): Promise<LyricsProviderResult | null> => {
                    const raw = await getLyricFn(track.title, track.artist, track.duration);
                    if (!raw) return null;

                    // String => assume standard LRC format
                    if (typeof raw === 'string') {
                        const lines = parseLrc(raw);
                        return {
                            lines,
                            source: manifest.name,
                            format: 'lrc',
                        };
                    }

                    // Object with raw LRC string
                    if (raw.lrc || raw.lyric) {
                        const lrcStr = raw.lrc || raw.lyric;
                        const lines = parseLrc(lrcStr);
                        return {
                            lines,
                            source: manifest.name,
                            format: 'lrc',
                        };
                    }

                    // Pre-parsed array of lines
                    if (Array.isArray(raw.lines)) {
                        return {
                            lines: raw.lines,
                            source: manifest.name,
                            format: 'json',
                            hasWordSync: !!raw.hasWordSync,
                            hasSyllableSync: !!raw.hasSyllableSync,
                        };
                    }

                    return null;
                },
            };
        }

        return result;
    } catch (err) {
        console.error(`[SflxAdapter] Failed to initialize extension '${manifest.name}':`, err);
        throw err;
    }
}
