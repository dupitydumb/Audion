// Typed Provider Interfaces for Modular Stream, Metadata, and Lyrics Providers
// Supports native Audion plugins as well as bridged providers (e.g., community .sflx)
import { writable } from 'svelte/store';

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
    [key: string]: any;
}

export interface MetadataArtistItem {
    id: string;
    name: string;
    avatar_url?: string;
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

export class ProviderRegistry {
    private streamProviders: Map<string, StreamProvider> = new Map();
    private metadataProviders: Map<string, MetadataProvider> = new Map();
    private lyricsProviders: Map<string, LyricsProvider> = new Map();

    private streamOwners: Map<string, string> = new Map(); // providerId -> pluginName
    private metadataOwners: Map<string, string> = new Map();
    private lyricsOwners: Map<string, string> = new Map();

    private config: ProviderSettingsStorage = loadStoredConfig();
    private telemetry: Map<string, TelemetryStats> = new Map();

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
        const list: ProviderItemEntry[] = [];
        for (const [id, provider] of this.streamProviders.entries()) {
            const cfg = this.config.stream[id] || { enabled: true, priority: 1 };
            list.push({
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
        for (const [id, provider] of this.metadataProviders.entries()) {
            const cfg = this.config.metadata[id] || { enabled: true, priority: 1 };
            list.push({
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
        for (const [id, provider] of this.lyricsProviders.entries()) {
            const cfg = this.config.lyrics[id] || { enabled: true, priority: 1 };
            list.push({
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
        return list;
    }

    setProviderEnabled(type: 'stream' | 'metadata' | 'lyrics', id: string, enabled: boolean): void {
        if (!this.config[type][id]) {
            this.config[type][id] = { enabled, priority: 999 };
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

        const currentItem = items[idx];
        const swapItem = items[targetIdx];

        const oldPri = currentItem.priority;
        const swapPri = swapItem.priority === oldPri
            ? (direction === 'up' ? oldPri - 1 : oldPri + 1)
            : swapItem.priority;

        this.setProviderPriority(type, currentItem.id, swapPri);
        this.setProviderPriority(type, swapItem.id, oldPri);

        // Normalize priorities
        const reordered = this.getProviderEntries()
            .filter(p => p.type === type)
            .sort((a, b) => a.priority - b.priority);
        reordered.forEach((p, i) => {
            if (this.config[type][p.id]) {
                this.config[type][p.id].priority = i + 1;
            }
        });
        saveStoredConfig(this.config);
        this.notifyStore();
    }

    resetPriorities(type: 'stream' | 'metadata' | 'lyrics'): void {
        const items = this.getProviderEntries().filter(p => p.type === type);
        items.forEach((p, i) => {
            if (this.config[type][p.id]) {
                this.config[type][p.id].priority = i + 1;
            }
        });
        saveStoredConfig(this.config);
        this.notifyStore();
    }

    // ── Stream Providers ──
    registerStreamProvider(provider: StreamProvider, ownerPlugin: string = 'system'): void {
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

    unregisterStreamProvider(id: string): void {
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
        const t0 = performance.now();
        try {
            const res = await provider.getStream(songId, quality);
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
                    const full = await sp.resolveByQuery({
                        title: track.title,
                        artist: track.artist || undefined,
                        album: track.album || undefined,
                        duration: track.duration || undefined
                    }, quality);
                    this.recordTelemetry(sp.id, Math.round(performance.now() - t0), !!full);
                    if (full) {
                        const formatted = typeof full === 'string' ? { url: full } : full;
                        return { ...formatted, isFullStream: true };
                    }
                } else {
                    const queryStr = `query:${track.title} ${track.artist || ''}`.trim();
                    const full = await sp.getStream(queryStr, quality);
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

    unregisterMetadataProvider(id: string): void {
        this.metadataProviders.delete(id);
        this.metadataOwners.delete(id);
        this.notifyStore();
    }

    getMetadataProvider(id: string): MetadataProvider | undefined {
        return this.metadataProviders.get(id);
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
                const res = await p.search(query, type, page);
                const hasResults = !!((res.tracks && res.tracks.length > 0) || (res.albums && res.albums.length > 0) || (res.artists && res.artists.length > 0));
                this.recordTelemetry(p.id, Math.round(performance.now() - t0), true);
                if (res.tracks) combined.tracks!.push(...res.tracks);
                if (res.albums) combined.albums!.push(...res.albums);
                if (res.artists) combined.artists!.push(...res.artists);
            } catch (err) {
                this.recordTelemetry(p.id, Math.round(performance.now() - t0), false);
                console.warn(`[ProviderRegistry] MetadataProvider '${p.id}' search failed:`, err);
            }
        });

        await Promise.allSettled(promises);
        return combined;
    }

    // ── Lyrics Providers ──
    registerLyricsProvider(provider: LyricsProvider, ownerPlugin: string = 'system'): void {
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

    unregisterLyricsProvider(id: string): void {
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
                const res = await provider.getLyrics(track);
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
