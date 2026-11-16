// Typed Provider Interfaces for Modular Stream, Metadata, and Lyrics Providers
// Supports native Audion plugins as well as bridged providers (e.g., community .sflx)

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

export class ProviderRegistry {
    private streamProviders: Map<string, StreamProvider> = new Map();
    private metadataProviders: Map<string, MetadataProvider> = new Map();
    private lyricsProviders: Map<string, LyricsProvider> = new Map();

    private streamOwners: Map<string, string> = new Map(); // providerId -> pluginName
    private metadataOwners: Map<string, string> = new Map();
    private lyricsOwners: Map<string, string> = new Map();

    // ── Stream Providers ──
    registerStreamProvider(provider: StreamProvider, ownerPlugin: string = 'system'): void {
        this.streamProviders.set(provider.id, provider);
        this.streamOwners.set(provider.id, ownerPlugin);
        console.log(`[ProviderRegistry] Registered StreamProvider '${provider.id}' (${provider.name}) from '${ownerPlugin}'`);
    }

    unregisterStreamProvider(id: string): void {
        this.streamProviders.delete(id);
        this.streamOwners.delete(id);
    }

    getStreamProvider(id: string): StreamProvider | undefined {
        return this.streamProviders.get(id);
    }

    getAllStreamProviders(): StreamProvider[] {
        return Array.from(this.streamProviders.values());
    }

    async resolveStream(providerId: string, songId: string, quality?: string): Promise<StreamSourceResult | null> {
        const provider = this.streamProviders.get(providerId);
        if (!provider) {
            console.warn(`[ProviderRegistry] StreamProvider '${providerId}' not found`);
            return null;
        }
        try {
            const res = await provider.getStream(songId, quality);
            if (!res) return null;
            if (typeof res === 'string') {
                return { url: res };
            }
            return res;
        } catch (err) {
            console.error(`[ProviderRegistry] StreamProvider '${providerId}' failed to resolve stream:`, err);
            return null;
        }
    }

    /**
     * Resolves an audio stream for a track, bridging catalog/metadata items
     * to full-length audio from active StreamProviders with fallback to 30-second previews.
     */
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
            try {
                if (typeof sp.resolveByQuery === 'function') {
                    const full = await sp.resolveByQuery({
                        title: track.title,
                        artist: track.artist || undefined,
                        album: track.album || undefined,
                        duration: track.duration || undefined
                    }, quality);
                    if (full) {
                        const formatted = typeof full === 'string' ? { url: full } : full;
                        return { ...formatted, isFullStream: true };
                    }
                } else {
                    const queryStr = `query:${track.title} ${track.artist || ''}`.trim();
                    const full = await sp.getStream(queryStr, quality);
                    if (full) {
                        const formatted = typeof full === 'string' ? { url: full } : full;
                        return { ...formatted, isFullStream: true };
                    }
                }
            } catch (err) {
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
        console.log(`[ProviderRegistry] Registered MetadataProvider '${provider.id}' (${provider.name}) from '${ownerPlugin}'`);
    }

    unregisterMetadataProvider(id: string): void {
        this.metadataProviders.delete(id);
        this.metadataOwners.delete(id);
    }

    getMetadataProvider(id: string): MetadataProvider | undefined {
        return this.metadataProviders.get(id);
    }

    getAllMetadataProviders(): MetadataProvider[] {
        return Array.from(this.metadataProviders.values());
    }

    async searchAllMetadata(query: string, type: 'all' | 'track' | 'album' | 'artist' = 'all', page: number = 1): Promise<MetadataSearchResult> {
        const combined: MetadataSearchResult = { tracks: [], albums: [], artists: [] };
        const providers = this.getAllMetadataProviders();

        const promises = providers.map(async (p) => {
            try {
                const res = await p.search(query, type, page);
                if (res.tracks) combined.tracks!.push(...res.tracks);
                if (res.albums) combined.albums!.push(...res.albums);
                if (res.artists) combined.artists!.push(...res.artists);
            } catch (err) {
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
        console.log(`[ProviderRegistry] Registered LyricsProvider '${provider.id}' (${provider.name}) from '${ownerPlugin}'`);
    }

    unregisterLyricsProvider(id: string): void {
        this.lyricsProviders.delete(id);
        this.lyricsOwners.delete(id);
    }

    getLyricsProvider(id: string): LyricsProvider | undefined {
        return this.lyricsProviders.get(id);
    }

    getAllLyricsProviders(): LyricsProvider[] {
        return Array.from(this.lyricsProviders.values());
    }

    async fetchLyricsFromProviders(track: {
        title: string;
        artist: string;
        album?: string;
        duration?: number;
    }): Promise<LyricsProviderResult | null> {
        const providers = this.getAllLyricsProviders();
        for (const provider of providers) {
            try {
                const res = await provider.getLyrics(track);
                if (res && res.lines && res.lines.length > 0) {
                    return res;
                }
            } catch (err) {
                console.warn(`[ProviderRegistry] LyricsProvider '${provider.id}' failed:`, err);
            }
        }
        return null;
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
