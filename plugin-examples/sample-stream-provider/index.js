// Sample Stream Provider for Audion v1.5.0+
// Demonstrates how to build an audio stream provider modeled after YouTube Music / InnerTube
// with multi-context fallbacks, quality negotiation, and format selection.

(function () {
  'use strict';

  const PROVIDER_ID = 'sample-stream-provider';
  const PROVIDER_NAME = 'Sample Stream Provider';

  // InnerTube player contexts (Android & TV Embedded provide direct unclamped audio streams)
  const STREAM_CONTEXTS = [
    {
      label: 'android',
      key:   'AIzaSyA8eiZmM1fadkCPco2mFCOFqNTKFz7a_WA',
      clientId: '3',
      context: { client: { clientName: 'ANDROID', clientVersion: '21.26.364', androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'en', gl: 'US' } },
      userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
    },
    {
      label: 'android_vr',
      key:   'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientId: '28',
      context: { client: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12', hl: 'en', gl: 'US' } },
      userAgent: 'Mozilla/5.0 (Android 12; VR) AppleWebKit/537.36',
    },
    {
      label: 'ios',
      key:   'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientId: '5',
      context: { client: { clientName: 'IOS', clientVersion: '21.26.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', hl: 'en', gl: 'US' } },
      userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
    },
    {
      label: 'tv_embedded',
      key:   'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientId: '85',
      context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' }, thirdParty: { embedUrl: 'https://www.youtube.com/' } },
    },
  ];

  // Federated fallback endpoints
  const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://pipedapi.leptons.xyz'
  ];

  const SampleStreamProvider = {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    version: '1.0.0',
    description: 'Reference audio stream provider resolving audio formats via InnerTube & Piped with quality selection.',
    api: null,

    /**
     * Initializes the plugin and registers the StreamProvider into Audion's ProviderRegistry.
     * @param {object} api - Audion Plugin API instance
     */
    async init(api) {
      this.api = api;

      if (api.stream && typeof api.stream.registerProvider === 'function') {
        api.stream.registerProvider({
          id: this.id,
          name: this.name,
          version: this.version,
          description: this.description,
          getStream: (songId, quality) => this.getStream(songId, quality),
          resolveByQuery: (track, quality) => this.resolveByQuery(track, quality)
        });
        console.log(`[${PROVIDER_NAME}] Successfully registered StreamProvider '${this.id}'`);
      } else if (api.stream && typeof api.stream.registerResolver === 'function') {
        // Fallback for earlier Audion versions
        api.stream.registerResolver(this.id, async (songId, opts) => {
          const res = await this.getStream(songId, opts?.quality);
          return typeof res === 'string' ? res : (res?.url || null);
        });
      }
    },

    /**
     * Resolves an audio stream for a given songId and quality tier.
     * @param {string} songId - Track or video external ID (e.g. YouTube Video ID or catalog track ID)
     * @param {string} [quality='high'] - Desired quality tier ('lossless' | 'high' | 'standard' | 'low')
     * @returns {Promise<{ url: string, format?: string, bitrate?: number, headers?: Record<string, string>, rawBlobUrl?: string } | string | null>}
     */
    async getStream(songId, quality = 'high') {
      if (!songId) {
        console.warn(`[${PROVIDER_NAME}] getStream called with empty songId`);
        return null;
      }

      // If queried by search query rather than raw videoId
      if (typeof songId === 'string' && songId.startsWith('query:')) {
        const queryText = songId.substring(6).trim();
        return await this.resolveByQuery(queryText, quality);
      }

      console.log(`[${PROVIDER_NAME}] Resolving stream for '${songId}' (Quality: ${quality})`);

      // 1. Try InnerTube player endpoints
      const innerTubeResult = await this._tryInnerTube(songId, quality);
      if (innerTubeResult) return innerTubeResult;

      // 2. Fallback to federated Piped instances
      const pipedResult = await this._tryPiped(songId, quality);
      if (pipedResult) return pipedResult;

      console.error(`[${PROVIDER_NAME}] Failed to resolve audio stream for '${songId}' across all backends`);
      return null;
    },

    /**
     * Resolves a full-length audio stream by searching song title and artist.
     * Connects metadata/catalog providers directly to full-length audio streams.
     * @param {{ title: string, artist?: string, album?: string, duration?: number } | string} track
     * @param {string} [quality='high']
     */
    async resolveByQuery(track, quality = 'high') {
      const queryStr = typeof track === 'string'
        ? track
        : `${track.title || ''} ${track.artist || ''}`.trim();

      if (!queryStr) return null;
      console.log(`[${PROVIDER_NAME}] Resolving full audio stream for query: "${queryStr}"`);

      // Search InnerTube music search for matching videoId
      const videoId = await this._searchInnerTubeVideoId(queryStr);
      if (videoId) {
        return await this.getStream(videoId, quality);
      }

      return null;
    },

    /**
     * Searches InnerTube for the best matching music videoId.
     * @private
     */
    async _searchInnerTubeVideoId(query) {
      try {
        const url = 'https://music.youtube.com/youtubei/v1/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-KLET5YdCE';
        const body = JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20241127.01.00',
              hl: 'en',
              gl: 'US'
            }
          },
          query,
          params: 'EgWKAQIIAWoKEAoQBRAJEAMQBA%3D%3D' // Filter for music songs
        });

        const res = await this._fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          body
        });

        if (!res.ok) return null;
        const text = await res.text();
        // Extract top matching videoId
        const match = text.match(/"videoId":\s*"([a-zA-Z0-9_-]{11})"/);
        if (match && match[1]) {
          console.log(`[${PROVIDER_NAME}] Matched videoId '${match[1]}' for query "${query}"`);
          return match[1];
        }
      } catch (err) {
        console.warn(`[${PROVIDER_NAME}] Search matching failed:`, err);
      }
      return null;
    },

    /**
     * Attempts to resolve stream via InnerTube player API contexts.
     * Matches YouTube Music's proven un-ciphered player endpoints.
     * @private
     */
    async _tryInnerTube(songId, quality) {
      const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';

      for (const ctx of STREAM_CONTEXTS) {
        try {
          const url = `${INNERTUBE_BASE}/player?key=${ctx.key}&prettyPrint=false`;
          const body = JSON.stringify({
            videoId: songId,
            context: ctx.context,
            playbackContext: { contentPlaybackContext: { signatureTimestamp: 19950 } }
          });

          const res = await this._fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-YouTube-Client-Name': ctx.clientId,
              'X-YouTube-Client-Version': ctx.context.client.clientVersion,
              ...(ctx.userAgent ? { 'User-Agent': ctx.userAgent } : {})
            },
            body
          });

          if (!res.ok) continue;
          const data = await res.json();
          const streamingData = data?.streamingData;
          if (!streamingData) continue;

          const formats = [
            ...(streamingData.adaptiveFormats || []),
            ...(streamingData.formats || [])
          ];

          // Plain formats without signature cipher
          const plain = formats.filter(f => f.url && !f.signatureCipher && !f.cipher);
          if (!plain.length) continue;

          // Pick best format according to requested quality tier
          const selected = this._pickFormatByQuality(plain, quality);
          if (!selected || !selected.url) continue;

          const formatName = selected.mimeType?.includes('webm') ? 'webm' : 'm4a';
          const bitrate = selected.bitrate || selected.averageBitrate || 160000;

          // If running inside Tauri and CORS proxy is available, convert to blob to prevent origin blocking
          let rawBlobUrl = undefined;
          if (this.api && typeof this.api.fetchBlob === 'function') {
            try {
              const mime = formatName === 'webm' ? 'audio/webm' : 'audio/mp4';
              rawBlobUrl = await this.api.fetchBlob(selected.url, mime);
            } catch (blobErr) {
              console.warn(`[${PROVIDER_NAME}] fetchBlob proxy warning:`, blobErr);
            }
          }

          return {
            url: selected.url,
            format: formatName,
            bitrate,
            headers: {
              'User-Agent': ctx.userAgent || 'Mozilla/5.0',
              'Range': 'bytes=0-'
            },
            ...(rawBlobUrl ? { rawBlobUrl } : {})
          };
        } catch (err) {
          console.warn(`[${PROVIDER_NAME}] InnerTube context (${ctx.label}) error:`, err);
        }
      }
      return null;
    },

    /**
     * Attempts to resolve stream via federated Piped instances.
     * @private
     */
    async _tryPiped(songId, quality) {
      for (const base of PIPED_INSTANCES) {
        try {
          const res = await this._fetch(`${base}/streams/${songId}`);
          if (!res.ok) continue;

          const data = await res.json();
          const streams = data.audioStreams || [];
          if (!streams.length) continue;

          const selected = this._pickFormatByQuality(streams, quality);
          if (!selected || !selected.url) continue;

          return {
            url: selected.url,
            format: selected.format?.toLowerCase() || (selected.mimeType?.includes('webm') ? 'webm' : 'm4a'),
            bitrate: selected.bitrate || 160000,
            headers: { 'Range': 'bytes=0-' }
          };
        } catch (err) {
          console.warn(`[${PROVIDER_NAME}] Piped instance (${base}) failed:`, err);
        }
      }
      return null;
    },

    /**
     * Sorts and selects format matching the target quality tier.
     * Prioritizes dedicated audio streams, falling back to muxed audio containers.
     * @private
     */
    _pickFormatByQuality(formats, quality = 'high') {
      if (!formats || !formats.length) return null;

      // Prefer dedicated audio streams (audio/* without video dimensions)
      const audio = formats.filter(f => f.url && f.mimeType && f.mimeType.startsWith('audio/') && !f.width && !f.height);
      if (audio.length) {
        const pool = [...audio].sort((a, b) => (b.bitrate || b.averageBitrate || 0) - (a.bitrate || a.averageBitrate || 0));
        switch (quality) {
          case 'low':
            return pool[pool.length - 1];
          case 'standard':
            return pool.length > 2 ? pool[Math.floor(pool.length / 2)] : pool[0];
          default:
            return pool[0];
        }
      }

      // Fall back to muxed containers (mp4 with audio), which Audion plays directly
      const muxed = formats.filter(f => f.url && (f.mimeType?.includes('video/mp4') || f.mimeType?.includes('audio')));
      if (muxed.length) {
        muxed.sort((a, b) => (b.audioQuality === 'AUDIO_QUALITY_MEDIUM' ? 1 : 0) - (a.audioQuality === 'AUDIO_QUALITY_MEDIUM' ? 1 : 0));
        return muxed[0];
      }

      // Any available plain URL
      const any = formats.filter(f => f.url);
      return any[0] || null;
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
    Audion.register(SampleStreamProvider);
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.SampleStreamProvider = SampleStreamProvider;
    globalThis.AudionPlugin = SampleStreamProvider;
  }
  if (typeof window !== 'undefined') {
    window.SampleStreamProvider = SampleStreamProvider;
    window.AudionPlugin = SampleStreamProvider;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SampleStreamProvider;
  }
})();
