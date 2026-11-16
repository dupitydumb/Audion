/**
 * Three-Tier Smart Playlist Importer (M5.1)
 *
 * Formats supported:
 *  - .m3u / .m3u8 (Standard Extended M3U and simple file lists)
 *  - .json (Spotify JSON exports, .sflx exports, Audion playlist backups)
 *  - .txt (One track per line: "Artist - Title" or "Title by Artist")
 *
 * Matching Resolution Waterfall:
 *  - Tier 1 (Local Library): SQLite library path and fuzzy (title, artist, duration ±3s) match
 *  - Tier 2 (Self-Hosted): Subsonic / Navidrome API search match
 *  - Tier 3 (Stream Providers): Active registered plugins (Community / Tidal / YouTube Music)
 */

import { searchLibrary, createPlaylist, addTrackToPlaylist, type Track } from '$lib/api/tauri';
import { subsonicConnected, subsonicSearch } from '$lib/stores/subsonic';
import { globalProviders } from '$lib/plugins/providers';
import { loadPlaylists } from '$lib/stores/library';
import { get } from 'svelte/store';

export interface ParsedTrackEntry {
    rawLine?: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number; // in seconds
    path?: string;
}

export type MatchSource = 'local' | 'subsonic' | 'provider' | 'none';

export interface ResolvedTrackItem {
    id: string;
    entry: ParsedTrackEntry;
    matchSource: MatchSource;
    matchedTrackId?: number;
    matchedTrackTitle?: string | null;
    matchedTrackArtist?: string | null;
    matchedTrackPath?: string | null;
    providerName?: string;
    status: 'matched' | 'unmatched';
}

export interface PlaylistImportResult {
    playlistName: string;
    total: number;
    matchedCount: number;
    unmatchedCount: number;
    tier1LocalCount: number;
    tier2SubsonicCount: number;
    tier3ProviderCount: number;
    items: ResolvedTrackItem[];
}

/**
 * Clean & normalize strings for fuzzy comparisons
 */
export function normalizeString(str: string): string {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .replace(/\((feat|ft|remastered|deluxe|version)[^)]*\)/gi, '')
        .replace(/\[(feat|ft|remastered|deluxe|version)[^\]]*\]/gi, '')
        .replace(/[^a-z0-9\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Simple token-overlap similarity metric (0.0 to 1.0)
 */
export function tokenSimilarity(a: string, b: string): number {
    const na = normalizeString(a);
    const nb = normalizeString(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1.0;

    const setA = new Set(na.split(' ').filter(Boolean));
    const setB = new Set(nb.split(' ').filter(Boolean));
    if (setA.size === 0 || setB.size === 0) return 0;

    let overlap = 0;
    for (const t of setA) {
        if (setB.has(t)) overlap++;
    }

    const minSize = Math.min(setA.size, setB.size);
    const maxSize = Math.max(setA.size, setB.size);
    return (overlap / minSize) * 0.7 + (overlap / maxSize) * 0.3;
}

/**
 * Parse an M3U / M3U8 string
 */
export function parseM3u(content: string, defaultName: string = 'Imported Playlist'): { name: string; tracks: ParsedTrackEntry[] } {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let playlistName = defaultName;
    const tracks: ParsedTrackEntry[] = [];

    let currentDuration: number | undefined;
    let currentArtist: string = 'Unknown Artist';
    let currentTitle: string = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('#PLAYLIST:')) {
            playlistName = line.replace('#PLAYLIST:', '').trim() || defaultName;
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            // #EXTINF:seconds,Artist - Title  OR  #EXTINF:seconds,Title
            const commaIndex = line.indexOf(',');
            const colonIndex = line.indexOf(':');

            if (colonIndex !== -1 && commaIndex !== -1 && commaIndex > colonIndex) {
                const durationStr = line.substring(colonIndex + 1, commaIndex).trim();
                const dur = parseInt(durationStr, 10);
                if (!isNaN(dur) && dur > 0) {
                    currentDuration = dur;
                }
            }

            const infoStr = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : '';
            if (infoStr.includes(' - ')) {
                const parts = infoStr.split(' - ');
                currentArtist = parts[0]?.trim() || 'Unknown Artist';
                currentTitle = parts.slice(1).join(' - ').trim();
            } else if (infoStr.includes(' — ')) {
                const parts = infoStr.split(' — ');
                currentArtist = parts[0]?.trim() || 'Unknown Artist';
                currentTitle = parts.slice(1).join(' — ').trim();
            } else {
                currentTitle = infoStr;
                currentArtist = 'Unknown Artist';
            }
            continue;
        }

        if (line.startsWith('#')) {
            // Ignore other comments
            continue;
        }

        // It is a file path / URL line
        const filePath = line;
        let title = currentTitle;
        let artist = currentArtist;

        // If no EXTINF preceded it, infer from filename
        if (!title) {
            const filename = filePath.split(/[/\\]/).pop() || '';
            const cleanName = filename.replace(/\.[a-zA-Z0-9]+$/, '');
            if (cleanName.includes(' - ')) {
                const parts = cleanName.split(' - ');
                artist = parts[0]?.trim() || 'Unknown Artist';
                title = parts.slice(1).join(' - ').trim();
            } else {
                title = cleanName;
            }
        }

        if (title) {
            tracks.push({
                rawLine: line,
                title,
                artist,
                duration: currentDuration,
                path: filePath.startsWith('http') ? undefined : filePath,
            });
        }

        // Reset state for next track
        currentDuration = undefined;
        currentArtist = 'Unknown Artist';
        currentTitle = '';
    }

    return { name: playlistName, tracks };
}

/**
 * Parse Spotify JSON, .sflx playlist export, or Audion JSON backup
 */
export function parsePlaylistJson(content: string, defaultName: string = 'Imported Playlist'): { name: string; tracks: ParsedTrackEntry[] } {
    let data: any;
    try {
        data = JSON.parse(content);
    } catch {
        return { name: defaultName, tracks: [] };
    }

    let playlistName = data.name || data.title || defaultName;
    const tracks: ParsedTrackEntry[] = [];

    // Spotify playlist export format: { name: "...", tracks: [ { name, artists: [{ name }], album: { name }, duration_ms } ] }
    if (Array.isArray(data.tracks)) {
        for (const t of data.tracks) {
            const item = t.track || t;
            const title = item.name || item.title || '';
            let artist = 'Unknown Artist';
            if (Array.isArray(item.artists)) {
                artist = item.artists.map((a: any) => typeof a === 'string' ? a : a.name).filter(Boolean).join(', ');
            } else if (item.artist) {
                artist = typeof item.artist === 'string' ? item.artist : item.artist.name || 'Unknown Artist';
            }

            const album = item.album ? (typeof item.album === 'string' ? item.album : item.album.name) : undefined;
            const duration = item.duration_ms ? Math.round(item.duration_ms / 1000) : item.duration;
            const path = item.path || item.uri;

            if (title) {
                tracks.push({ title, artist, album, duration, path });
            }
        }
    } else if (Array.isArray(data.songs)) {
        // Generic songs format: { title, songs: [ { title, artist, album, duration } ] }
        for (const s of data.songs) {
            const title = s.title || s.name || '';
            const artist = s.artist || s.author || 'Unknown Artist';
            const album = s.album;
            const duration = s.duration;
            if (title) {
                tracks.push({ title, artist, album, duration });
            }
        }
    } else if (Array.isArray(data)) {
        // Simple array of objects
        for (const item of data) {
            const title = item.title || item.name;
            const artist = item.artist || 'Unknown Artist';
            if (title) {
                tracks.push({
                    title,
                    artist,
                    album: item.album,
                    duration: item.duration,
                    path: item.path,
                });
            }
        }
    }

    return { name: playlistName, tracks };
}

/**
 * Parse plain text lists: "Artist - Title" per line
 */
export function parsePlainText(content: string, defaultName: string = 'Imported Playlist'): { name: string; tracks: ParsedTrackEntry[] } {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const tracks: ParsedTrackEntry[] = [];

    for (const line of lines) {
        if (line.includes(' - ')) {
            const parts = line.split(' - ');
            tracks.push({
                rawLine: line,
                artist: parts[0]?.trim() || 'Unknown Artist',
                title: parts.slice(1).join(' - ').trim(),
            });
        } else if (line.includes(' — ')) {
            const parts = line.split(' — ');
            tracks.push({
                rawLine: line,
                artist: parts[0]?.trim() || 'Unknown Artist',
                title: parts.slice(1).join(' — ').trim(),
            });
        } else if (line.toLowerCase().includes(' by ')) {
            const parts = line.split(/ by /i);
            tracks.push({
                rawLine: line,
                title: parts[0]?.trim() || '',
                artist: parts.slice(1).join(' by ').trim() || 'Unknown Artist',
            });
        } else {
            tracks.push({
                rawLine: line,
                title: line,
                artist: 'Unknown Artist',
            });
        }
    }

    return { name: defaultName, tracks };
}

/**
 * Universal playlist file parser
 */
export function parsePlaylistFile(content: string, filename: string): { name: string; tracks: ParsedTrackEntry[] } {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const cleanBaseName = filename.replace(/\.[^/.]+$/, '').trim();

    if (ext === 'json' || content.trim().startsWith('{') || content.trim().startsWith('[')) {
        return parsePlaylistJson(content, cleanBaseName);
    }
    if (ext === 'm3u' || ext === 'm3u8' || content.includes('#EXTM3U') || content.includes('#EXTINF:')) {
        return parseM3u(content, cleanBaseName);
    }
    return parsePlainText(content, cleanBaseName);
}

/**
 * Execute Three-Tier Matching Waterfall
 */
export async function resolvePlaylistWaterfall(
    parsed: { name: string; tracks: ParsedTrackEntry[] },
    onProgress?: (done: number, total: number) => void
): Promise<PlaylistImportResult> {
    const isSubsonic = get(subsonicConnected);
    const metadataProviders = globalProviders.getAllMetadataProviders();

    const items: ResolvedTrackItem[] = [];
    let tier1Count = 0;
    let tier2Count = 0;
    let tier3Count = 0;

    const total = parsed.tracks.length;

    for (let i = 0; i < total; i++) {
        const entry = parsed.tracks[i];
        const id = `item-${i}-${Date.now()}`;
        let matched = false;

        // ─────────────────────────────────────────────────────────────
        // Tier 1: Local SQLite Library
        // ─────────────────────────────────────────────────────────────
        try {
            const searchRes = await searchLibrary(entry.title, 8, 0);
            if (searchRes && searchRes.tracks && searchRes.tracks.length > 0) {
                // Find closest match
                let bestTrack: Track | null = null;
                let bestScore = 0;

                for (const candidate of searchRes.tracks) {
                    const titleSim = tokenSimilarity(candidate.title || '', entry.title);
                    const artistSim = entry.artist && entry.artist !== 'Unknown Artist'
                        ? tokenSimilarity(candidate.artist || '', entry.artist)
                        : 0.8; // neutral score if unknown

                    const totalScore = titleSim * 0.6 + artistSim * 0.4;
                    if (totalScore > bestScore) {
                        bestScore = totalScore;
                        bestTrack = candidate;
                    }
                }

                if (bestTrack && bestScore >= 0.65) {
                    items.push({
                        id,
                        entry,
                        matchSource: 'local',
                        matchedTrackId: bestTrack.id,
                        matchedTrackTitle: bestTrack.title,
                        matchedTrackArtist: bestTrack.artist,
                        matchedTrackPath: bestTrack.path,
                        status: 'matched',
                    });
                    tier1Count++;
                    matched = true;
                }
            }
        } catch (err) {
            console.warn('[PlaylistImport] Tier 1 local search error for', entry.title, err);
        }

        // ─────────────────────────────────────────────────────────────
        // Tier 2: Self-Hosted / Subsonic
        // ─────────────────────────────────────────────────────────────
        if (!matched && isSubsonic) {
            try {
                const subQuery = entry.artist && entry.artist !== 'Unknown Artist'
                    ? `${entry.artist} ${entry.title}`
                    : entry.title;

                const subRes = await subsonicSearch(subQuery, 5);
                if (subRes && subRes.songs && subRes.songs.length > 0) {
                    let bestSubSong = subRes.songs[0];
                    let bestSubScore = 0;

                    for (const candidate of subRes.songs) {
                        const titleSim = tokenSimilarity(candidate.title || '', entry.title);
                        const artistSim = entry.artist && entry.artist !== 'Unknown Artist'
                            ? tokenSimilarity(candidate.artist || '', entry.artist)
                            : 0.8;
                        const score = titleSim * 0.6 + artistSim * 0.4;
                        if (score > bestSubScore) {
                            bestSubScore = score;
                            bestSubSong = candidate;
                        }
                    }

                    if (bestSubScore >= 0.6) {
                        items.push({
                            id,
                            entry,
                            matchSource: 'subsonic',
                            matchedTrackTitle: bestSubSong.title,
                            matchedTrackArtist: bestSubSong.artist,
                            status: 'matched',
                        });
                        tier2Count++;
                        matched = true;
                    }
                }
            } catch (err) {
                console.warn('[PlaylistImport] Tier 2 subsonic search error for', entry.title, err);
            }
        }

        // ─────────────────────────────────────────────────────────────
        // Tier 3: Active Stream / Metadata Providers (Plugins / Tidal / etc.)
        // ─────────────────────────────────────────────────────────────
        if (!matched && metadataProviders.length > 0) {
            const providerQuery = entry.artist && entry.artist !== 'Unknown Artist'
                ? `${entry.artist} ${entry.title}`
                : entry.title;

            for (const provider of metadataProviders) {
                try {
                    const provRes = await provider.search(providerQuery, 'track', 1);
                    if (provRes && provRes.tracks && provRes.tracks.length > 0) {
                        const first = provRes.tracks[0];
                        const titleSim = tokenSimilarity(first.title, entry.title);
                        if (titleSim >= 0.5) {
                            items.push({
                                id,
                                entry,
                                matchSource: 'provider',
                                providerName: provider.name,
                                matchedTrackTitle: first.title,
                                matchedTrackArtist: first.artist,
                                status: 'matched',
                            });
                            tier3Count++;
                            matched = true;
                            break;
                        }
                    }
                } catch (provErr) {
                    console.warn(`[PlaylistImport] Tier 3 provider '${provider.name}' search error:`, provErr);
                }
            }
        }

        // ─────────────────────────────────────────────────────────────
        // Unmatched fallback
        // ─────────────────────────────────────────────────────────────
        if (!matched) {
            items.push({
                id,
                entry,
                matchSource: 'none',
                status: 'unmatched',
            });
        }

        if (onProgress) {
            onProgress(i + 1, total);
        }
    }

    const matchedCount = tier1Count + tier2Count + tier3Count;
    const unmatchedCount = total - matchedCount;

    return {
        playlistName: parsed.name,
        total,
        matchedCount,
        unmatchedCount,
        tier1LocalCount: tier1Count,
        tier2SubsonicCount: tier2Count,
        tier3ProviderCount: tier3Count,
        items,
    };
}

/**
 * Commit the resolved playlist into Audion's SQLite database
 */
export async function commitPlaylistImport(
    result: PlaylistImportResult,
    customName?: string
): Promise<{ playlistId: number; importedTrackCount: number }> {
    const finalName = (customName || result.playlistName || 'Imported Playlist').trim();
    const playlistId = await createPlaylist(finalName);

    let importedTrackCount = 0;
    for (const item of result.items) {
        if (item.matchSource === 'local' && item.matchedTrackId) {
            try {
                await addTrackToPlaylist(playlistId, item.matchedTrackId);
                importedTrackCount++;
            } catch (err) {
                console.error(`[PlaylistImport] Failed adding track ${item.matchedTrackId} to playlist ${playlistId}:`, err);
            }
        }
    }

    await loadPlaylists();
    return { playlistId, importedTrackCount };
}
