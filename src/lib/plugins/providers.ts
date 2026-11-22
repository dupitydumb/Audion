// Typed Provider Interfaces for Modular Stream, Metadata, and Lyrics Providers
// Supports native Audion plugins as well as bridged providers (e.g., community .sflx)
import { writable } from 'svelte/store';
import {
    searchArtistsMb,
    searchReleasesMb,
    getArtistMusicBrainzInfo,
    getArtistDiscographyMb,
    getReleaseGroupTracksMb,
    getArtistTopTracksMb,
} from '$lib/api/tauri';

export interface StreamSourceResult {
    url: string;
    format?: string;
    bitrate?: number;
    headers?: Record<string, string>;
    rawBlobUrl?: string;
}

export interface StreamProvider {
    id: string;
    name: string;
    version?: string;
    description?: string;
    getStream(songId: string, quality?: string): Promise<StreamSourceResult | string | null>;
    resolveByQuery?(track: { title: string; artist?: string; album?: string; duration?: number } | string, quality?: string): Promise<StreamSourceResult | string | null>;
}

export interface MetadataTrackItem {
    id: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    cover_url?: string;
    source_type?: string;
    external_id?: string;
    provider_id?: string;
    artist_id?: string;
    album_id?: string;
    track_number?: number;
    disc_number?: number;
    bitrate?: number;
    format?: string;
    [key: string]: any;
}

export interface MetadataAlbumItem {
    id: string;
    title: string;
    artist: string;
    cover_url?: string;
    year?: number;
    track_count?: number;
    artist_id?: string;
    provider_id?: string;
    source_type?: string;
    release_type?: string;
    genres?: string[];
    tracks?: MetadataTrackItem[];
    [key: string]: any;
}

export interface MetadataArtistItem {
    id: string;
    name: string;
    avatar_url?: string;
    country?: string;
    active_years?: string;
    genres?: string[];
    bio?: string;
    disambiguation?: string;
    provider_id?: string;
    source_type?: string;
    albums?: MetadataAlbumItem[];
    tracks?: MetadataTrackItem[];
    [key: string]: any;
}

export interface MetadataSearchResult {
    tracks?: MetadataTrackItem[];
    albums?: MetadataAlbumItem[];
    artists?: MetadataArtistItem[];
}

export interface MetadataProvider {
    id: string;
    name: string;
    version?: string;
    description?: string;
    search(query: string, type?: 'all' | 'track' | 'album' | 'artist', page?: number): Promise<MetadataSearchResult>;
    getAlbum?(id: string): Promise<any>;
    getArtist?(id: string): Promise<any>;
    getTrack?(id: string): Promise<MetadataTrackItem | null>;
}

export interface LyricsProviderResult {
    lines: Array<{
        time: number;
        text: string;
        words?: any[];
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

export interface ProviderConfigEntry {
    enabled: boolean;
    priority: number;
}

export interface ProviderItemEntry {
    id: string;
    name: string;
    type: 'stream' | 'metadata' | 'lyrics';
    version?: string;
    description?: string;
    ownerPlugin: string;
    enabled: boolean;
    priority: number;
}

export interface ProviderTelemetryEntry {
    id: string;
    name: string;
    type: 'stream' | 'metadata' | 'lyrics';
    ownerPlugin: string;
    enabled: boolean;
    priority: number;
    totalRequests: number;
    successCount: number;
    errorCount: number;
    lastLatencyMs: number | null;
    avgLatencyMs: number | null;
    lastUsed: number | null;
    status: 'healthy' | 'degraded' | 'offline' | 'idle';
}

interface TelemetryStats {
    totalRequests: number;
    successCount: number;
    errorCount: number;
    lastLatencyMs: number | null;
    avgLatencyMs: number | null;
    lastUsed: number | null;
    status: 'healthy' | 'degraded' | 'offline' | 'idle';
}

const CONFIG_STORAGE_KEY = 'audion_provider_config_v1';

interface ProviderSettingsStorage {
    stream: Record<string, ProviderConfigEntry>;
    metadata: Record<string, ProviderConfigEntry>;
    lyrics: Record<string, ProviderConfigEntry>;
}

function loadStoredConfig(): ProviderSettingsStorage {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined' || typeof window.localStorage.getItem !== 'function') {
        return { stream: {}, metadata: {}, lyrics: {} };
    }
    try {
        const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                stream: parsed.stream || {},
                metadata: parsed.metadata || {},
                lyrics: parsed.lyrics || {}
            };
        }
    } catch (e) {
        console.warn('[ProviderRegistry] Failed to parse provider config from localStorage:', e);
    }
    return { stream: {}, metadata: {}, lyrics: {} };
}

function saveStoredConfig(cfg: ProviderSettingsStorage): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined' || typeof window.localStorage.setItem !== 'function') return;
    try {
        window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {
        console.warn('[ProviderRegistry] Failed to save provider config to localStorage:', e);
    }
}

export const providersStore = writable<ProviderItemEntry[]>([]);
export const providerTelemetryStore = writable<ProviderTelemetryEntry[]>([]);

export class MusicBrainzMetadataProvider implements MetadataProvider {
    id = 'musicbrainz';
    name = 'MusicBrainz';
    version = '1.0.0';
    description = 'Open music encyclopedia with discography, tracklists, and artist info';

    async search(query: string, type: 'all' | 'track' | 'album' | 'artist' = 'all', page: number = 1): Promise<MetadataSearchResult> {
        const limit = 20;
        const result: MetadataSearchResult = { tracks: [], albums: [], artists: [] };
        const tasks: Promise<void>[] = [];
        let artistError: any = null;
        let albumError: any = null;

        if (type === 'all' || type === 'artist') {
            tasks.push(
                searchArtistsMb(query, limit)
                    .then(artists => {
                        result.artists = artists.map(a => ({
                            id: a.mbid,
                            name: a.name,
                            country: a.country || undefined,
                            active_years: a.active_years || undefined,
                            genres: a.genres || [],
                            disambiguation: a.disambiguation || undefined,
                            source_type: 'musicbrainz',
                            provider_id: 'musicbrainz'
                        }));
                    })
                    .catch(e => {
                        artistError = e;
                        console.warn('[MusicBrainzMetadataProvider] searchArtists failed:', e);
                    })
            );
        }
        if (type === 'all' || type === 'album') {
            tasks.push(
                searchReleasesMb(query, limit)
                    .then(releases => {
                        result.albums = releases.map(r => ({
                            id: r.mbid,
                            title: r.title,
                            artist: r.artist_name,
                            artist_id: r.artist_mbid || undefined,
                            year: r.year ? parseInt(r.year, 10) : undefined,
                            cover_url: `https://coverartarchive.org/release-group/${r.mbid}/front-250`,
                            release_type: r.release_type,
                            genres: r.genres || [],
                            source_type: 'musicbrainz',
                            provider_id: 'musicbrainz'
                        }));
                    })
                    .catch(e => {
                        albumError = e;
                        console.warn('[MusicBrainzMetadataProvider] searchReleases failed:', e);
                    })
            );
        }

        await Promise.all(tasks);

        const requestedCount = (type === 'all' ? 2 : 1);
        const errorCount = (artistError ? 1 : 0) + (albumError ? 1 : 0);
        if (requestedCount > 0 && errorCount === requestedCount) {
            throw new Error(`MusicBrainz search failed for all requested categories: ${artistError || albumError}`);
        }

        return result;
    }

    async getAlbum(id: string) {
        try {
            const tracks = await getReleaseGroupTracksMb(id);
            return {
                id,
                cover_url: `https://coverartarchive.org/release-group/${id}/front-250`,
                source_type: 'musicbrainz',
                provider_id: 'musicbrainz',
                tracks: tracks.map((t, idx) => ({
                    id: t.mbid || `mb-${id}-${idx}`,
                    external_id: t.mbid,
                    source_type: 'musicbrainz',
                    provider_id: 'musicbrainz',
                    title: t.title,
                    artist: t.artist,
                    track_number: t.track_number,
                    disc_number: t.disc_number,
                    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
                    album_id: id,
                    cover_url: `https://coverartarchive.org/release-group/${id}/front-250`
                }))
            };
        } catch (e) {
            console.warn('[MusicBrainzMetadataProvider] getAlbum failed:', e);
            return null;
        }
    }

    async getArtist(idOrName: string) {
        try {
            const [info, disco] = await Promise.all([
                getArtistMusicBrainzInfo(idOrName).catch(() => null),
                getArtistDiscographyMb(idOrName).catch(() => [])
            ]);
            let topTracks: any[] = [];
            const mbid = info?.mbid || (idOrName.length === 36 && idOrName.includes('-') ? idOrName : '');
            if (mbid) {
                topTracks = await getArtistTopTracksMb(mbid).catch(() => []);
            }
            return {
                id: mbid || idOrName,
                name: info?.name || idOrName,
                bio: info?.bio || undefined,
                genres: info?.genres || [],
                wikipedia_url: info?.wikipedia_url || undefined,
                source_type: 'musicbrainz',
                provider_id: 'musicbrainz',
                tracks: topTracks.map((t, idx) => ({
                    id: t.mbid || `mb-top-${idx}`,
                    external_id: t.mbid,
                    source_type: 'musicbrainz',
                    provider_id: 'musicbrainz',
                    title: t.title,
                    artist: t.artist || info?.name || idOrName,
                    track_number: t.track_number,
                    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
                    cover_url: `https://coverartarchive.org/release-group/${t.mbid}/front-250`
                })),
                albums: (disco || []).map(d => ({
                    id: d.mbid,
                    title: d.title,
                    year: d.year,
                    release_type: d.release_type,
                    cover_url: `https://coverartarchive.org/release-group/${d.mbid}/front-250`,
                    source_type: 'musicbrainz',
                    provider_id: 'musicbrainz'
                }))
            };
        } catch (e) {
            console.warn('[MusicBrainzMetadataProvider] getArtist failed:', e);
            return null;
        }
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, desc: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout of ${ms}ms exceeded for ${desc}`));
        }, ms);
        promise.then(
            (val) => {
                clearTimeout(timer);
                resolve(val);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

export class ProviderRegistry {
    private streamProviders: Map<string, StreamProvider> = new Map();
    private metadataProviders: Map<string, MetadataProvider> = new Map();
    private lyricsProviders: Map<string, LyricsProvider> = new Map();

    private streamOwners: Map<string, string> = new Map(); // providerId -> pluginName
    private metadataOwners: Map<string, string> = new Map();
    private lyricsOwners: Map<string, string> = new Map();

    private config: ProviderSettingsStorage = loadStoredConfig();
    private telemetry: Map<string, TelemetryStats> = new Map();

    constructor() {
        this.registerMetadataProvider(new MusicBrainzMetadataProvider(), 'system');
    }

    private notifyStore(): void {
        providersStore.set(this.getProviderEntries());
        this.notifyTelemetryStore();
    }

    private notifyTelemetryStore(): void {
        const list: ProviderTelemetryEntry[] = [];
        const entries = this.getProviderEntries();

        for (const item of entries) {
            const stats = this.telemetry.get(item.id) || {
                totalRequests: 0,
                successCount: 0,
                errorCount: 0,
                lastLatencyMs: null,
                avgLatencyMs: null,
                lastUsed: null,
                status: 'idle',
            };

            list.push({
                ...item,
                ...stats,
            });
        }

        providerTelemetryStore.set(list);
    }

    public recordTelemetry(id: string, latencyMs: number, success: boolean): void {
        let stats = this.telemetry.get(id);
        if (!stats) {
            stats = {
                totalRequests: 0,
                successCount: 0,
                errorCount: 0,
                lastLatencyMs: null,
                avgLatencyMs: null,
                lastUsed: null,
                status: 'idle',
            };
            this.telemetry.set(id, stats);
        }

        stats.totalRequests++;
        if (success) {
            stats.successCount++;
        } else {
            stats.errorCount++;
        }

        stats.lastLatencyMs = latencyMs;
        stats.lastUsed = Date.now();

        if (stats.avgLatencyMs === null) {
            stats.avgLatencyMs = latencyMs;
        } else {
            stats.avgLatencyMs = Math.round(stats.avgLatencyMs * 0.7 + latencyMs * 0.3);
        }

        const errorRate = stats.errorCount / stats.totalRequests;
        if (errorRate > 0.4) {
            stats.status = 'degraded';
        } else if (!success && stats.totalRequests === stats.errorCount) {
            stats.status = 'offline';
        } else {
            stats.status = 'healthy';
        }

        this.notifyTelemetryStore();
    }

    getProviderEntries(): ProviderItemEntry[] {
        const streamList: ProviderItemEntry[] = [];
        for (const [id, provider] of this.streamProviders.entries()) {
            const cfg = this.config.stream[id] || { enabled: true, priority: 1 };
            streamList.push({
                id,
                name: provider.name,
                type: 'stream',
                version: provider.version,
                description: provider.description,
                ownerPlugin: this.streamOwners.get(id) || 'system',
                enabled: cfg.enabled,
                priority: cfg.priority,
            });
        }
        streamList.sort((a, b) => a.priority - b.priority);

        const metadataList: ProviderItemEntry[] = [];
        for (const [id, provider] of this.metadataProviders.entries()) {
            const cfg = this.config.metadata[id] || { enabled: true, priority: 1 };
            metadataList.push({
                id,
                name: provider.name,
                type: 'metadata',
                version: provider.version,
                description: provider.description,
                ownerPlugin: this.metadataOwners.get(id) || 'system',
                enabled: cfg.enabled,
                priority: cfg.priority,
            });
        }
        metadataList.sort((a, b) => a.priority - b.priority);

        const lyricsList: ProviderItemEntry[] = [];
        for (const [id, provider] of this.lyricsProviders.entries()) {
            const cfg = this.config.lyrics[id] || { enabled: true, priority: 1 };
            lyricsList.push({
                id,
                name: provider.name,
                type: 'lyrics',
                version: provider.version,
                description: provider.description,
                ownerPlugin: this.lyricsOwners.get(id) || 'system',
                enabled: cfg.enabled,
                priority: cfg.priority,
            });
        }
        lyricsList.sort((a, b) => a.priority - b.priority);

        return [...streamList, ...metadataList, ...lyricsList];
    }

    setProviderEnabled(type: 'stream' | 'metadata' | 'lyrics', id: string, enabled: boolean): void {
        if (!this.config[type][id]) {
            const existingPriorities = Object.values(this.config[type]).map(c => c.priority);
            const nextPri = existingPriorities.length > 0 ? Math.max(...existingPriorities) + 1 : 1;
            this.config[type][id] = { enabled, priority: nextPri };
        } else {
            this.config[type][id].enabled = enabled;
        }
        saveStoredConfig(this.config);
        this.notifyStore();
    }

    setProviderPriority(type: 'stream' | 'metadata' | 'lyrics', id: string, priority: number): void {
        if (!this.config[type][id]) {
            this.config[type][id] = { enabled: true, priority };
        } else {
            this.config[type][id].priority = priority;
        }
        saveStoredConfig(this.config);
        this.notifyStore();
    }

    moveProviderPriority(type: 'stream' | 'metadata' | 'lyrics', id: string, direction: 'up' | 'down'): void {
        const items = this.getProviderEntries()
            .filter(p => p.type === type)
            .sort((a, b) => a.priority - b.priority);

        const idx = items.findIndex(p => p.id === id);
        if (idx === -1) return;

        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= items.length) return;

        const [movedItem] = items.splice(idx, 1);
        items.splice(targetIdx, 0, movedItem);

        // Normalize priorities sequentially 1..N
        items.forEach((p, i) => {
            if (!this.config[type][p.id]) {
                this.config[type][p.id] = { enabled: p.enabled, priority: i + 1 };
            } else {
                this.config[type][p.id].priority = i + 1;
            }
        });

        saveStoredConfig(this.config);
        this.notifyStore();
    }

    resetPriorities(type: 'stream' | 'metadata' | 'lyrics'): void {
        let map: Map<string, any>;
        if (type === 'stream') map = this.streamProviders;
        else if (type === 'metadata') map = this.metadataProviders;
        else map = this.lyricsProviders;

        let i = 1;
        for (const id of map.keys()) {
            if (!this.config[type][id]) {
                this.config[type][id] = { enabled: true, priority: i };
            } else {
                this.config[type][id].priority = i;
            }
            i++;
        }
        saveStoredConfig(this.config);
        this.notifyStore();
    }

    // ── Stream Providers ──
    registerStreamProvider(provider: StreamProvider, ownerPlugin: string = 'system'): void {
        const currentOwner = this.streamOwners.get(provider.id);
        if (currentOwner && currentOwner !== ownerPlugin && ownerPlugin !== 'system') {
            console.warn(`[ProviderRegistry] Cannot overwrite StreamProvider '${provider.id}' owned by '${currentOwner}'`);
            return;
        }
        this.streamProviders.set(provider.id, provider);
        this.streamOwners.set(provider.id, ownerPlugin);

        if (!this.config.stream[provider.id]) {
            const priorities = Object.values(this.config.stream).map(c => c.priority);
            const nextPri = priorities.length > 0 ? Math.max(...priorities) + 1 : 1;
            this.config.stream[provider.id] = { enabled: true, priority: nextPri };
            saveStoredConfig(this.config);
        }

        console.log(`[ProviderRegistry] Registered StreamProvider '${provider.id}' (${provider.name}) from '${ownerPlugin}'`);
        this.notifyStore();
    }

    unregisterStreamProvider(id: string, callerPlugin: string = 'system'): void {
        const currentOwner = this.streamOwners.get(id);
        if (callerPlugin !== 'system' && currentOwner && currentOwner !== callerPlugin) {
            console.warn(`[ProviderRegistry] Plugin '${callerPlugin}' cannot unregister StreamProvider '${id}' owned by '${currentOwner}'`);
            return;
        }
        this.streamProviders.delete(id);
        this.streamOwners.delete(id);
        this.notifyStore();
    }

    getStreamProvider(id: string): StreamProvider | undefined {
        return this.streamProviders.get(id);
    }

    getAllStreamProviders(): StreamProvider[] {
        const list: Array<{ provider: StreamProvider; priority: number }> = [];
        for (const [id, provider] of this.streamProviders.entries()) {
            const cfg = this.config.stream[id] || { enabled: true, priority: 999 };
            if (cfg.enabled) {
                list.push({ provider, priority: cfg.priority });
            }
        }
        list.sort((a, b) => a.priority - b.priority);
        return list.map(item => item.provider);
    }

    async resolveStream(providerId: string, songId: string, quality?: string): Promise<StreamSourceResult | null> {
        const provider = this.streamProviders.get(providerId);
        if (!provider) {
            console.warn(`[ProviderRegistry] StreamProvider '${providerId}' not found`);
            return null;
        }
        const cfg = this.config.stream[providerId];
        if (cfg && cfg.enabled === false) {
            // disabled providers must not be used by direct source_type lookups either
            return null;
        }
        const t0 = performance.now();
        try {
            const res = await withTimeout(Promise.resolve(provider.getStream(songId, quality)), 5000, `StreamProvider ${providerId}`);
            this.recordTelemetry(providerId, Math.round(performance.now() - t0), !!res);
            if (!res) return null;
            if (typeof res === 'string') {
                return { url: res };
            }
            return res;
        } catch (err) {
            this.recordTelemetry(providerId, Math.round(performance.now() - t0), false);
            console.error(`[ProviderRegistry] StreamProvider '${providerId}' failed to resolve stream:`, err);
            return null;
        }
    }

    async resolveTrackStream(
        track: {
            title: string;
            artist?: string | null;
            album?: string | null;
            duration?: number | null;
            source_type?: string | null;
            external_id?: string | null;
            preview_url?: string | null;
            path?: string | null;
        },
        quality?: string
    ): Promise<{ url: string; format?: string; bitrate?: number; headers?: Record<string, string>; rawBlobUrl?: string; isFullStream: boolean } | null> {
        // 1. If direct provider is registered for this source_type, try direct getStream
        if (track.source_type && track.external_id) {
            const provider = this.getStreamProvider(track.source_type);
            if (provider) {
                const res = await this.resolveStream(track.source_type, track.external_id, quality);
                if (res) {
                    return { ...res, isFullStream: true };
                }
            }
        }

        // 2. Query active StreamProviders for full-length audio stream by title + artist
        const streamProviders = this.getAllStreamProviders();
        for (const sp of streamProviders) {
            const t0 = performance.now();
            try {
                if (typeof sp.resolveByQuery === 'function') {
                    const full = await withTimeout(Promise.resolve(sp.resolveByQuery({
                        title: track.title,
                        artist: track.artist || undefined,
                        album: track.album || undefined,
                        duration: track.duration || undefined
                    }, quality)), 5000, `StreamProvider ${sp.id} resolveByQuery`);
                    this.recordTelemetry(sp.id, Math.round(performance.now() - t0), !!full);
                    if (full) {
                        const formatted = typeof full === 'string' ? { url: full } : full;
                        return { ...formatted, isFullStream: true };
                    }
                } else {
                    const queryStr = `query:${track.title} ${track.artist || ''}`.trim();
                    const full = await withTimeout(Promise.resolve(sp.getStream(queryStr, quality)), 5000, `StreamProvider ${sp.id} getStream`);
                    this.recordTelemetry(sp.id, Math.round(performance.now() - t0), !!full);
                    if (full) {
                        const formatted = typeof full === 'string' ? { url: full } : full;
                        return { ...formatted, isFullStream: true };
                    }
                }
            } catch (err) {
                this.recordTelemetry(sp.id, Math.round(performance.now() - t0), false);
                console.warn(`[ProviderRegistry] StreamProvider '${sp.id}' query resolution failed:`, err);
            }
        }

        // 3. Fallback to 30-second preview if available
        const preview = track.preview_url || (track.path && (track.path.startsWith('http://') || track.path.startsWith('https://')) ? track.path : null);
        if (preview) {
            return { url: preview, isFullStream: false };
        }

        return null;
    }

    // ── Metadata Providers ──
    registerMetadataProvider(provider: MetadataProvider, ownerPlugin: string = 'system'): void {
        const currentOwner = this.metadataOwners.get(provider.id);
        if (currentOwner && currentOwner !== ownerPlugin && ownerPlugin !== 'system') {
            console.warn(`[ProviderRegistry] Cannot overwrite MetadataProvider '${provider.id}' owned by '${currentOwner}'`);
            return;
        }
        this.metadataProviders.set(provider.id, provider);
        this.metadataOwners.set(provider.id, ownerPlugin);

        if (!this.config.metadata[provider.id]) {
            const priorities = Object.values(this.config.metadata).map(c => c.priority);
            const nextPri = priorities.length > 0 ? Math.max(...priorities) + 1 : 1;
            this.config.metadata[provider.id] = { enabled: true, priority: nextPri };
            saveStoredConfig(this.config);
        }

        console.log(`[ProviderRegistry] Registered MetadataProvider '${provider.id}' (${provider.name}) from '${ownerPlugin}'`);
        this.notifyStore();
    }

    unregisterMetadataProvider(id: string, callerPlugin: string = 'system'): void {
        const currentOwner = this.metadataOwners.get(id);
        if (callerPlugin !== 'system' && currentOwner && currentOwner !== callerPlugin) {
            console.warn(`[ProviderRegistry] Plugin '${callerPlugin}' cannot unregister MetadataProvider '${id}' owned by '${currentOwner}'`);
            return;
        }
        this.metadataProviders.delete(id);
        this.metadataOwners.delete(id);
        this.notifyStore();
    }

    getMetadataProvider(id: string): MetadataProvider | undefined {
        return this.metadataProviders.get(id);
    }

    getEnabledMetadataProvider(id: string): MetadataProvider | undefined {
        const provider = this.metadataProviders.get(id);
        if (!provider) return undefined;
        const cfg = this.config.metadata[id];
        if (cfg && cfg.enabled === false) return undefined;
        return provider;
    }

    getAllMetadataProviders(): MetadataProvider[] {
        const list: Array<{ provider: MetadataProvider; priority: number }> = [];
        for (const [id, provider] of this.metadataProviders.entries()) {
            const cfg = this.config.metadata[id] || { enabled: true, priority: 999 };
            if (cfg.enabled) {
                list.push({ provider, priority: cfg.priority });
            }
        }
        list.sort((a, b) => a.priority - b.priority);
        return list.map(item => item.provider);
    }

    async searchAllMetadata(query: string, type: 'all' | 'track' | 'album' | 'artist' = 'all', page: number = 1): Promise<MetadataSearchResult> {
        const combined: MetadataSearchResult = { tracks: [], albums: [], artists: [] };
        const providers = this.getAllMetadataProviders();

        const promises = providers.map(async (p) => {
            const t0 = performance.now();
            try {
                const res = await withTimeout(Promise.resolve(p.search(query, type, page)), 7000, `MetadataProvider ${p.id} search`);
                const hasResults = !!((res.tracks && res.tracks.length > 0) || (res.albums && res.albums.length > 0) || (res.artists && res.artists.length > 0));
                this.recordTelemetry(p.id, Math.round(performance.now() - t0), true);
                if (res.tracks) {
                    for (const t of res.tracks) {
                        if (!t.provider_id) t.provider_id = p.id;
                        if (!t.source_type) t.source_type = p.id;
                        combined.tracks!.push(t);
                    }
                }
                if (res.albums) {
                    for (const a of res.albums) {
                        if (!a.provider_id) a.provider_id = p.id;
                        if (!a.source_type) a.source_type = p.id;
                        combined.albums!.push(a);
                    }
                }
                if (res.artists) {
                    for (const ar of res.artists) {
                        if (!ar.provider_id) ar.provider_id = p.id;
                        if (!ar.source_type) ar.source_type = p.id;
                        combined.artists!.push(ar);
                    }
                }
            } catch (err) {
                this.recordTelemetry(p.id, Math.round(performance.now() - t0), false);
                console.warn(`[ProviderRegistry] MetadataProvider '${p.id}' search failed:`, err);
            }
        });

        await Promise.allSettled(promises);
        return combined;
    }

    async searchProviderMetadata(
        providerId: string,
        query: string,
        type: 'all' | 'track' | 'album' | 'artist' = 'all',
        page: number = 1
    ): Promise<MetadataSearchResult> {
        if (!providerId || providerId === 'all') {
            return await this.searchAllMetadata(query, type, page);
        }
        const provider = this.getEnabledMetadataProvider(providerId);
        if (!provider) {
            console.warn(`[ProviderRegistry] Enabled MetadataProvider '${providerId}' not found, falling back to all`);
            return await this.searchAllMetadata(query, type, page);
        }
        const t0 = performance.now();
        try {
            const res = await withTimeout(Promise.resolve(provider.search(query, type, page)), 7000, `MetadataProvider ${providerId} search`);
            this.recordTelemetry(provider.id, Math.round(performance.now() - t0), true);
            const tracks = (res.tracks || []).map(t => ({
                ...t,
                provider_id: t.provider_id || provider.id,
                source_type: t.source_type || provider.id
            }));
            const albums = (res.albums || []).map(a => ({
                ...a,
                provider_id: a.provider_id || provider.id,
                source_type: a.source_type || provider.id
            }));
            const artists = (res.artists || []).map(ar => ({
                ...ar,
                provider_id: ar.provider_id || provider.id,
                source_type: ar.source_type || provider.id
            }));
            return { tracks, albums, artists };
        } catch (err) {
            this.recordTelemetry(provider.id, Math.round(performance.now() - t0), false);
            console.warn(`[ProviderRegistry] MetadataProvider '${providerId}' search failed:`, err);
            return { tracks: [], albums: [], artists: [] };
        }
    }

    async getAlbum(id: string, providerId?: string, albumTitle?: string, artistName?: string): Promise<any> {
        let res: any = null;
        if (providerId) {
            const provider = this.getEnabledMetadataProvider(providerId);
            if (provider && typeof provider.getAlbum === 'function') {
                try {
                    res = await withTimeout(Promise.resolve(provider.getAlbum(id)), 7000, `MetadataProvider ${providerId} getAlbum`);
                } catch (e) {
                    console.warn(`[ProviderRegistry] Provider '${providerId}' getAlbum failed:`, e);
                }
            }
        } else {
            for (const provider of this.getAllMetadataProviders()) {
                if (typeof provider.getAlbum === 'function') {
                    try {
                        res = await withTimeout(Promise.resolve(provider.getAlbum(id)), 7000, `MetadataProvider ${provider.id} getAlbum`);
                        if (res) break;
                    } catch (_) {}
                }
            }
        }
        // Fallback search if no tracks found or album lookup failed
        if (!res || !res.tracks || res.tracks.length === 0) {
            const query = (albumTitle || (id.startsWith('title-') ? decodeURIComponent(id.replace(/^title-/, '')) : id)).trim();
            if (query) {
                try {
                    const searchTarget = artistName ? `${query} ${artistName}` : query;
                    const searchRes = providerId 
                        ? await this.searchProviderMetadata(providerId, searchTarget, 'track')
                        : await this.searchAllMetadata(searchTarget, 'track');
                    if (searchRes && searchRes.tracks && searchRes.tracks.length > 0) {
                        const targetAlbumLower = query.toLowerCase();
                        const verifiedTracks = searchRes.tracks.filter(t => {
                            if (!t.album) return false;
                            const aLower = t.album.toLowerCase();
                            return aLower === targetAlbumLower || aLower.includes(targetAlbumLower) || targetAlbumLower.includes(aLower);
                        });
                        if (verifiedTracks.length > 0) {
                            res = {
                                ...(res || {}),
                                id: res?.id || id,
                                title: res?.title || albumTitle || query,
                                artist: res?.artist || artistName || verifiedTracks[0]?.artist || 'Unknown Artist',
                                cover_url: res?.cover_url || verifiedTracks[0]?.cover_url,
                                source_type: res?.source_type || providerId,
                                provider_id: res?.provider_id || providerId,
                                tracks: verifiedTracks
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`[ProviderRegistry] Fallback album search failed:`, e);
                }
            }
        }
        return res;
    }

    async getArtist(id: string, providerId?: string, artistName?: string): Promise<any> {
        let res: any = null;
        if (providerId) {
            const provider = this.getEnabledMetadataProvider(providerId);
            if (provider && typeof provider.getArtist === 'function') {
                try {
                    res = await withTimeout(Promise.resolve(provider.getArtist(id)), 7000, `MetadataProvider ${providerId} getArtist`);
                } catch (e) {
                    console.warn(`[ProviderRegistry] Provider '${providerId}' getArtist failed:`, e);
                }
            }
        } else {
            for (const provider of this.getAllMetadataProviders()) {
                if (typeof provider.getArtist === 'function') {
                    try {
                        res = await withTimeout(Promise.resolve(provider.getArtist(id)), 7000, `MetadataProvider ${provider.id} getArtist`);
                        if (res) break;
                    } catch (_) {}
                }
            }
            if (!res && artistName && artistName !== id) {
                for (const provider of this.getAllMetadataProviders()) {
                    if (typeof provider.getArtist === 'function') {
                        try {
                            res = await withTimeout(Promise.resolve(provider.getArtist(artistName)), 7000, `MetadataProvider ${provider.id} getArtist`);
                            if (res) break;
                        } catch (_) {}
                    }
                }
            }
        }
        // Fallback search if no tracks/albums found or artist lookup failed
        if (!res || !res.tracks || res.tracks.length === 0) {
            const query = (artistName || (id.startsWith('name-') ? decodeURIComponent(id.replace(/^name-/, '')) : id)).trim();
            if (query) {
                try {
                    const [trackSearch, albumSearch] = await Promise.all([
                        providerId 
                            ? this.searchProviderMetadata(providerId, query, 'track') 
                            : this.searchAllMetadata(query, 'track'),
                        providerId 
                            ? this.searchProviderMetadata(providerId, query, 'album') 
                            : this.searchAllMetadata(query, 'album'),
                    ]);
                    const tracks = trackSearch?.tracks || [];
                    const albums = albumSearch?.albums || [];
                    if (tracks.length > 0 || albums.length > 0) {
                        res = {
                            ...(res || {}),
                            id: res?.id || id,
                            name: res?.name || artistName || query,
                            avatar_url: res?.avatar_url || tracks[0]?.cover_url,
                            source_type: res?.source_type || providerId,
                            provider_id: res?.provider_id || providerId,
                            tracks: (res?.tracks && res.tracks.length > 0) ? res.tracks : tracks,
                            albums: (res?.albums && res.albums.length > 0) ? res.albums : albums,
                        };
                    }
                } catch (e) {
                    console.warn(`[ProviderRegistry] Fallback artist search failed:`, e);
                }
            }
        }
        return res;
    }

    async getTrack(id: string, providerId?: string): Promise<MetadataTrackItem | null> {
        if (providerId) {
            const provider = this.getEnabledMetadataProvider(providerId);
            if (provider && typeof provider.getTrack === 'function') {
                try {
                    return await withTimeout(Promise.resolve(provider.getTrack(id)), 7000, `MetadataProvider ${providerId} getTrack`);
                } catch (e) {
                    console.warn(`[ProviderRegistry] Provider '${providerId}' getTrack failed:`, e);
                }
            }
            return null;
        }
        for (const provider of this.getAllMetadataProviders()) {
            if (typeof provider.getTrack === 'function') {
                try {
                    const res = await withTimeout(Promise.resolve(provider.getTrack(id)), 7000, `MetadataProvider ${provider.id} getTrack`);
                    if (res) return res;
                } catch (_) {}
            }
        }
        return null;
    }

    // ── Lyrics Providers ──
    registerLyricsProvider(provider: LyricsProvider, ownerPlugin: string = 'system'): void {
        const currentOwner = this.lyricsOwners.get(provider.id);
        if (currentOwner && currentOwner !== ownerPlugin && ownerPlugin !== 'system') {
            console.warn(`[ProviderRegistry] Cannot overwrite LyricsProvider '${provider.id}' owned by '${currentOwner}'`);
            return;
        }
        this.lyricsProviders.set(provider.id, provider);
        this.lyricsOwners.set(provider.id, ownerPlugin);

        if (!this.config.lyrics[provider.id]) {
            const priorities = Object.values(this.config.lyrics).map(c => c.priority);
            const nextPri = priorities.length > 0 ? Math.max(...priorities) + 1 : 1;
            this.config.lyrics[provider.id] = { enabled: true, priority: nextPri };
            saveStoredConfig(this.config);
        }

        console.log(`[ProviderRegistry] Registered LyricsProvider '${provider.id}' (${provider.name}) from '${ownerPlugin}'`);
        this.notifyStore();
    }

    unregisterLyricsProvider(id: string, callerPlugin: string = 'system'): void {
        const currentOwner = this.lyricsOwners.get(id);
        if (callerPlugin !== 'system' && currentOwner && currentOwner !== callerPlugin) {
            console.warn(`[ProviderRegistry] Plugin '${callerPlugin}' cannot unregister LyricsProvider '${id}' owned by '${currentOwner}'`);
            return;
        }
        this.lyricsProviders.delete(id);
        this.lyricsOwners.delete(id);
        this.notifyStore();
    }

    getLyricsProvider(id: string): LyricsProvider | undefined {
        return this.lyricsProviders.get(id);
    }

    getAllLyricsProviders(): LyricsProvider[] {
        const list: Array<{ provider: LyricsProvider; priority: number }> = [];
        for (const [id, provider] of this.lyricsProviders.entries()) {
            const cfg = this.config.lyrics[id] || { enabled: true, priority: 999 };
            if (cfg.enabled) {
                list.push({ provider, priority: cfg.priority });
            }
        }
        list.sort((a, b) => a.priority - b.priority);
        return list.map(item => item.provider);
    }

    async fetchLyricsFromProviders(track: {
        title: string;
        artist: string;
        album?: string;
        duration?: number;
    }): Promise<LyricsProviderResult | null> {
        const providers = this.getAllLyricsProviders();
        for (const provider of providers) {
            const t0 = performance.now();
            try {
                const res = await withTimeout(Promise.resolve(provider.getLyrics(track)), 6000, `LyricsProvider ${provider.id}`);
                const hasLyrics = !!(res && res.lines && res.lines.length > 0);
                this.recordTelemetry(provider.id, Math.round(performance.now() - t0), hasLyrics);
                if (hasLyrics) {
                    return res;
                }
            } catch (err) {
                this.recordTelemetry(provider.id, Math.round(performance.now() - t0), false);
                console.warn(`[ProviderRegistry] LyricsProvider '${provider.id}' failed:`, err);
            }
        }
        return null;
    }

    async pingProvider(type: 'stream' | 'metadata' | 'lyrics', id: string): Promise<number | null> {
        const t0 = performance.now();
        try {
            if (type === 'stream') {
                const sp = this.streamProviders.get(id);
                if (!sp) return null;
                const cfg = this.config.stream[id];
                if (cfg && cfg.enabled === false) return null;
                if (typeof sp.resolveByQuery === 'function') {
                    await sp.resolveByQuery({ title: 'ping', artist: 'test' });
                } else {
                    await sp.getStream('ping');
                }
            } else if (type === 'metadata') {
                const mp = this.metadataProviders.get(id);
                if (!mp) return null;
                await mp.search('ping', 'track', 1);
            } else if (type === 'lyrics') {
                const lp = this.lyricsProviders.get(id);
                if (!lp) return null;
                await lp.getLyrics({ title: 'ping', artist: 'test' });
            }
            const latency = Math.round(performance.now() - t0);
            this.recordTelemetry(id, latency, true);
            return latency;
        } catch (e) {
            const latency = Math.round(performance.now() - t0);
            this.recordTelemetry(id, latency, false);
            return null;
        }
    }

    // ── Plugin Unload Cleanup ──
    unregisterPluginProviders(pluginName: string): void {
        for (const [id, owner] of Array.from(this.streamOwners.entries())) {
            if (owner === pluginName) this.unregisterStreamProvider(id);
        }
        for (const [id, owner] of Array.from(this.metadataOwners.entries())) {
            if (owner === pluginName) this.unregisterMetadataProvider(id);
        }
        for (const [id, owner] of Array.from(this.lyricsOwners.entries())) {
            if (owner === pluginName) this.unregisterLyricsProvider(id);
        }
        this.notifyStore();
    }
}

// Global singleton instance
export const globalProviders = new ProviderRegistry();

// Expose on window for DevTools interactive debugging and console testing
if (typeof window !== 'undefined') {
    (window as any).audion = {
        ...(window as any).audion,
        providers: globalProviders,
        metadata: {
            search: (query: string, type: 'all' | 'track' | 'album' | 'artist' = 'all', page: number = 1) =>
                globalProviders.searchAllMetadata(query, type, page),
            searchProvider: (providerId: string, query: string, type: 'all' | 'track' | 'album' | 'artist' = 'all', page: number = 1) =>
                globalProviders.searchProviderMetadata(providerId, query, type, page),
            getAlbum: (id: string, providerId?: string, albumTitle?: string, artistName?: string) =>
                globalProviders.getAlbum(id, providerId, albumTitle, artistName),
            getArtist: (id: string, providerId?: string, artistName?: string) =>
                globalProviders.getArtist(id, providerId, artistName),
            getTrack: (id: string, providerId?: string) =>
                globalProviders.getTrack(id, providerId),
            getAll: () => globalProviders.getAllMetadataProviders(),
            get: (id: string) => globalProviders.getMetadataProvider(id)
        },
        stream: {
            resolve: (providerId: string, songId: string, quality?: string) =>
                globalProviders.resolveStream(providerId, songId, quality),
            resolveStream: (providerId: string, songId: string, quality?: string) =>
                globalProviders.resolveStream(providerId, songId, quality),
            resolveTrackStream: (track: any, quality?: string) =>
                globalProviders.resolveTrackStream(track, quality),
            getAll: () => globalProviders.getAllStreamProviders(),
            get: (id: string) => globalProviders.getStreamProvider(id)
        },
        lyrics: {
            fetch: (track: { title: string; artist: string; album?: string; duration?: number }) =>
                globalProviders.fetchLyricsFromProviders(track),
            fetchLyrics: (track: { title: string; artist: string; album?: string; duration?: number }) =>
                globalProviders.fetchLyricsFromProviders(track),
            getAll: () => globalProviders.getAllLyricsProviders(),
            get: (id: string) => globalProviders.getLyricsProvider(id)
        }
    };
    (window as any).globalProviders = globalProviders;
}
