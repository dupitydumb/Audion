// Plugin registry and marketplace client
import type { AudionPluginManifest } from './schema';
import { validateManifest } from './schema';

export interface MarketplacePlugin {
  manifest: AudionPluginManifest;
  curated: boolean;
  repo: string;
  manifest_url: string;
  stars?: number;
  downloads?: number;
  verified?: boolean;
  lastUpdated?: string;
}

export interface RegistryData {
  version: string;
  updated_at: string;
  plugins: MarketplacePlugin[];
}

// Cache for fetched plugins
const pluginCache = new Map<string, { data: MarketplacePlugin; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Curated registry URLs (with fallback)
const CURATED_REGISTRY_URLS = [
  'https://raw.githubusercontent.com/dupitydumb/audion-plugins/main/registry/main/registry.json',
];

// Local registry for development/testing
let localRegistryPath: string | null = null;

export function setLocalRegistry(path: string | null): void {
  localRegistryPath = path;
}

// Validate URL format
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Fetch with timeout
async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// Fetch curated registry
export async function fetchCuratedRegistry(): Promise<MarketplacePlugin[]> {
  // Try local registry first (for development)
  if (localRegistryPath) {
    try {
      const response = await fetch(localRegistryPath);
      if (response.ok) {
        const data: RegistryData = await response.json();
        return data.plugins.map(p => ({ ...p, curated: true }));
      }
    } catch (err) {
      console.warn('[Marketplace] Local registry failed:', err);
    }
  }

  // Try remote registries
  for (const url of CURATED_REGISTRY_URLS) {
    try {
      // Append timestamp to prevent caching
      const noCacheUrl = `${url}?t=${Date.now()}`;
      const response = await fetchWithTimeout(noCacheUrl);
      if (!response.ok) continue;

      const data: RegistryData = await response.json();

      // Validate each plugin manifest
      const validPlugins: MarketplacePlugin[] = [];
      for (const plugin of data.plugins) {
        if (validateManifest(plugin.manifest)) {
          validPlugins.push({ ...plugin, curated: true });
        } else {
          console.warn(`[Marketplace] Invalid manifest for: ${(plugin.manifest as any)?.name || 'unknown'}`);
        }
      }

      return validPlugins;
    } catch (err) {
      console.warn(`[Marketplace] Failed to fetch from ${url}:`, err);
    }
  }

  return [];
}

// Fetch a community plugin from manifest URL
export async function fetchCommunityPlugin(manifestUrl: string): Promise<MarketplacePlugin | null> {
  // Validate URL
  if (!isValidUrl(manifestUrl)) {
    console.warn(`[Marketplace] Invalid URL: ${manifestUrl}`);
    return null;
  }

  // Check cache
  const cached = pluginCache.get(manifestUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetchWithTimeout(manifestUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const manifest = await response.json();

    // Validate manifest
    if (!validateManifest(manifest)) {
      console.warn(`[Marketplace] Invalid community manifest: ${manifestUrl}`);
      return null;
    }

    const plugin: MarketplacePlugin = {
      manifest,
      curated: false,
      repo: manifest.repo || '',
      manifest_url: manifestUrl,
      verified: false
    };

    // Cache the result
    pluginCache.set(manifestUrl, { data: plugin, timestamp: Date.now() });

    return plugin;
  } catch (err) {
    console.error(`[Marketplace] Failed to fetch community plugin: ${manifestUrl}`, err);
    return null;
  }
}

// Fetch all marketplace plugins
export async function fetchMarketplacePlugins(communityUrls: string[] = []): Promise<MarketplacePlugin[]> {
  const results: MarketplacePlugin[] = [];

  // Fetch curated plugins
  const curated = await fetchCuratedRegistry();
  results.push(...curated);

  // Fetch community plugins in parallel
  const communityPromises = communityUrls.map(url => fetchCommunityPlugin(url));
  const communityResults = await Promise.all(communityPromises);

  for (const plugin of communityResults) {
    if (plugin) {
      results.push(plugin);
    }
  }

  return results;
}

// Search plugins by query
export function searchPlugins(plugins: MarketplacePlugin[], query: string): MarketplacePlugin[] {
  const q = query.toLowerCase().trim();
  if (!q) return plugins;

  return plugins.filter(p => {
    const m = p.manifest;
    return (
      m.name.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.author.toLowerCase().includes(q) ||
      m.tags?.some(t => t.toLowerCase().includes(q)) ||
      m.category?.toLowerCase().includes(q)
    );
  });
}

// Filter plugins by category
export function filterByCategory(plugins: MarketplacePlugin[], category: string): MarketplacePlugin[] {
  if (!category || category === 'all') return plugins;
  return plugins.filter(p => p.manifest.category === category);
}

// Clear plugin cache
export function clearPluginCache(): void {
  pluginCache.clear();
}

// Get plugin by name from list
export function getPluginByName(plugins: MarketplacePlugin[], name: string): MarketplacePlugin | undefined {
  return plugins.find(p => p.manifest.name === name);
}
