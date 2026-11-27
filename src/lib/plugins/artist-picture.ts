import { globalProviders } from './providers';
import { pluginStore } from '$lib/stores/plugin-store';

const inFlight = new Map<string, Promise<string | null>>();
const memoryCache = new Map<string, string | null>();

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Resolve an artist picture URL from:
 * 1. Registered CoverSources supporting `type: 'artist'`
 * 2. Registered MetadataProviders returning `artists[].avatar_url` for `type: 'artist'`
 * 3. Legacy `window.tidalSearchPlugin.searchArtistPictureForRPC` fallback
 */
export async function resolveArtistPicture(artistName: string): Promise<string | null> {
  const trimmed = artistName?.trim();
  if (!trimmed) return null;

  const key = normalizeKey(trimmed);
  if (memoryCache.has(key)) {
    return memoryCache.get(key) ?? null;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    try {
      // 1. Try CoverSources (if plugin runtime is ready)
      const runtime = pluginStore.getRuntime();
      if (runtime) {
        const results = await runtime.resolveCover({ title: '', artist: trimmed, type: 'artist' });
        const hit = results.find((r) => r.status === 'success' && !!r.url);
        if (hit?.url) {
          memoryCache.set(key, hit.url);
          return hit.url;
        }
      }

      // 2. Try MetadataProviders (skipping MusicBrainz which does not provide avatars)
      for (const provider of globalProviders.getAllMetadataProviders()) {
        if (provider.id === 'musicbrainz') continue;
        try {
          const res = await provider.search(trimmed, 'artist', 1);
          const match = res?.artists?.find(
            (a) => a.avatar_url && a.name.trim().toLowerCase() === key,
          ) || res?.artists?.find((a) => !!a.avatar_url);
          if (match?.avatar_url) {
            memoryCache.set(key, match.avatar_url);
            return match.avatar_url;
          }
        } catch {
          // try next provider
        }
      }

      // 3. Legacy fallback for Tidal Search plugin
      const legacyPlugin = (window as any).tidalSearchPlugin;
      if (legacyPlugin?.searchArtistPictureForRPC) {
        const legacyUrl = await legacyPlugin.searchArtistPictureForRPC(trimmed);
        if (legacyUrl) {
          memoryCache.set(key, legacyUrl);
          return legacyUrl;
        }
      }

      return null;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

export function clearArtistPictureMemoryCache(): void {
  memoryCache.clear();
}
