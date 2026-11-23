// Sample Metadata Provider for Audion v1.5.0+
// Reference implementation querying public catalogs with high-res artwork

const PROVIDER_ID = 'sample-metadata-provider';
const PROVIDER_NAME = 'Sample Metadata Provider';
const ITUNES_BASE = 'https://itunes.apple.com';

export const SampleMetadataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  version: '1.0.0',
  description: 'Reference catalog search and metadata provider querying public music databases with high-res artwork.',
  api: null,

  async init(api) {
    this.api = api;

    if (api.metadata && typeof api.metadata.registerProvider === 'function') {
      api.metadata.registerProvider({
        id: this.id,
        name: this.name,
        version: this.version,
        description: this.description,
        search: (query, type, page) => this.search(query, type, page),
        getTrack: (id) => this.getTrack(id),
        getAlbum: (id) => this.getAlbum(id),
        getArtist: (id) => this.getArtist(id)
      });
      console.log(`[${PROVIDER_NAME}] Successfully registered MetadataProvider '${this.id}'`);
    } else {
      console.warn(`[${PROVIDER_NAME}] api.metadata.registerProvider is not available`);
    }
  },

  async search(query, type = 'all', page = 1) {
    if (!query || !query.trim()) {
      return { tracks: [], albums: [], artists: [] };
    }

    const limit = 25;
    const offset = (page - 1) * limit;

    let entityParam = 'song,album,musicArtist';
    if (type === 'track') entityParam = 'song';
    else if (type === 'album') entityParam = 'album';
    else if (type === 'artist') entityParam = 'musicArtist';

    const searchUrl = `${ITUNES_BASE}/search?term=${encodeURIComponent(query.trim())}&entity=${entityParam}&limit=${limit}&offset=${offset}&media=music`;

    try {
      console.log(`[${PROVIDER_NAME}] Searching '${query}' (Type: ${type}, Page: ${page})`);
      const res = await this._fetch(searchUrl);
      if (!res.ok) {
        console.warn(`[${PROVIDER_NAME}] Search failed with HTTP ${res.status}`);
        return { tracks: [], albums: [], artists: [] };
      }

      const data = await res.json();
      const results = data.results || [];

      const tracks = [];
      const albums = [];
      const artists = [];

      for (const item of results) {
        if (item.wrapperType === 'track' && item.kind === 'song') {
          tracks.push(this._normalizeTrack(item));
        } else if (item.wrapperType === 'collection' && item.collectionType === 'Album') {
          albums.push(this._normalizeAlbum(item));
        } else if (item.wrapperType === 'artist') {
          artists.push(this._normalizeArtist(item));
        }
      }

      return { tracks, albums, artists };
    } catch (err) {
      console.error(`[${PROVIDER_NAME}] Search error:`, err);
      return { tracks: [], albums: [], artists: [] };
    }
  },

  async getTrack(id) {
    try {
      const lookupUrl = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(id)}`;
      const res = await this._fetch(lookupUrl);
      if (!res.ok) return null;
      const data = await res.json();
      const item = data.results && data.results[0];
      return item ? this._normalizeTrack(item) : null;
    } catch (err) {
      console.error(`[${PROVIDER_NAME}] getTrack error:`, err);
      return null;
    }
  },

  async getAlbum(id) {
    try {
      const lookupUrl = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(id)}&entity=song`;
      const res = await this._fetch(lookupUrl);
      if (!res.ok) return null;
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) return null;

      const albumItem = results[0];
      const trackItems = results.slice(1);

      const album = this._normalizeAlbum(albumItem);
      album.tracks = trackItems.map(t => this._normalizeTrack(t));
      return album;
    } catch (err) {
      console.error(`[${PROVIDER_NAME}] getAlbum error:`, err);
      return null;
    }
  },

  async getArtist(id) {
    try {
      const lookupUrl = `${ITUNES_BASE}/lookup?id=${encodeURIComponent(id)}&entity=album`;
      const res = await this._fetch(lookupUrl);
      if (!res.ok) return null;
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) return null;

      const artistItem = results[0];
      const albumItems = results.slice(1);

      const artist = this._normalizeArtist(artistItem);
      artist.albums = albumItems.map(a => this._normalizeAlbum(a));
      return artist;
    } catch (err) {
      console.error(`[${PROVIDER_NAME}] getArtist error:`, err);
      return null;
    }
  },

  _normalizeTrack(item) {
    const trackId = item.trackId ? String(item.trackId) : (item.collectionId ? String(item.collectionId) : '');
    const duration = item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0;
    const coverUrl = this._upgradeCover(item.artworkUrl100 || item.artworkUrl60);

    return {
      id: trackId,
      external_id: trackId,
      title: item.trackName || 'Unknown Title',
      artist: item.artistName || 'Unknown Artist',
      artist_id: item.artistId ? String(item.artistId) : undefined,
      album: item.collectionName || undefined,
      album_id: item.collectionId ? String(item.collectionId) : undefined,
      duration,
      track_number: item.trackNumber || undefined,
      disc_number: item.discNumber || undefined,
      year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
      cover_url: coverUrl || undefined,
      genre: item.primaryGenreName,
      source_type: 'itunes',
      provider_id: this.id,
    };
  },

  _normalizeAlbum(item) {
    const albumId = item.collectionId ? String(item.collectionId) : '';
    const coverUrl = this._upgradeCover(item.artworkUrl100 || item.artworkUrl60);

    return {
      id: albumId,
      album_id: albumId,
      title: item.collectionName || 'Unknown Album',
      artist: item.artistName || 'Unknown Artist',
      artist_id: item.artistId ? String(item.artistId) : undefined,
      cover_url: coverUrl || undefined,
      year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
      track_count: item.trackCount || 0,
      genre: item.primaryGenreName,
      source_type: 'itunes',
      provider_id: this.id,
    };
  },

  _normalizeArtist(item) {
    const artistId = item.artistId ? String(item.artistId) : '';

    return {
      id: artistId,
      artist_id: artistId,
      name: item.artistName || 'Unknown Artist',
      genre: item.primaryGenreName,
      url: item.artistLinkUrl,
      source_type: 'itunes',
      provider_id: this.id,
    };
  },

  _upgradeCover(url) {
    if (!url || typeof url !== 'string') return '';
    return url.replace(/100x100bb\.(jpg|png|webp)/i, '1000x1000bb.$1');
  },

  async _fetch(url, opts) {
    if (this.api && typeof this.api.fetch === 'function') {
      return await this.api.fetch(url, opts);
    }
    return await fetch(url, opts);
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.SampleMetadataProvider = SampleMetadataProvider;
  globalThis.AudionPlugin = SampleMetadataProvider;
}

export default SampleMetadataProvider;
