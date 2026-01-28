// Plugin registry and marketplace client
import type { AudionPluginManifest } from './schema';
import { validateManifest, validateManifests } from './schema';

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

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum cached plugins
const CACHE_CLEANUP_INTERVAL = 60 * 1000; // Clean every minute

// cache with automatic cleanup
class PluginCache {
  private cache = new Map<string, { data: MarketplacePlugin; timestamp: number }>();
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Start periodic cleanup
    this.startCleanup();
  }

  get(url: string): MarketplacePlugin | null {
    const entry = this.cache.get(url);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(url);
      return null;
    }

    return entry.data;
  }

  set(url: string, data: MarketplacePlugin): void {
    // Enforce size limit
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    this.cache.set(url, { data, timestamp: Date.now() });
  }

  has(url: string): boolean {
    const entry = this.cache.get(url);
    if (!entry) return false;

    // Check if expired
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(url);
      return false;
    }

    return true;
  }

  delete(url: string): boolean {
    return this.cache.delete(url);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * Remove expired entries
   */
  private cleanExpired(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    this.cache.forEach((entry, url) => {
      if (now - entry.timestamp > CACHE_TTL) {
        toDelete.push(url);
      }
    });

    toDelete.forEach(url => this.cache.delete(url));

    if (toDelete.length > 0) {
      console.log(`[PluginCache] Cleaned ${toDelete.length} expired entries`);
    }
  }

  /**
   * Evict oldest entry to make room
   */
  private evictOldest(): void {
    let oldestUrl: string | null = null;
    let oldestTime = Date.now();

    this.cache.forEach((entry, url) => {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestUrl = url;
      }
    });

    if (oldestUrl) {
      this.cache.delete(oldestUrl);
      console.log(`[PluginCache] Evicted oldest entry: ${oldestUrl}`);
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanExpired();
    }, CACHE_CLEANUP_INTERVAL);
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: MAX_CACHE_SIZE
    };
  }
}

// Global cache instance
const pluginCache = new PluginCache();

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

        // Batch validate all manifests
        const validManifests = validateManifests(data.plugins.map(p => p.manifest));

        // Map back to plugins
        return data.plugins
          .filter(p => validManifests.includes(p.manifest as AudionPluginManifest))
          .map(p => ({ ...p, curated: true }));
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

      // Batch validate all manifests
      const validManifests = validateManifests(data.plugins.map(p => p.manifest));

      // Map back to plugins
      const validPlugins = data.plugins
        .filter(p => validManifests.includes(p.manifest as AudionPluginManifest))
        .map(p => ({ ...p, curated: true }));

      if (validPlugins.length < data.plugins.length) {
        console.warn(
          `[Marketplace] ${data.plugins.length - validPlugins.length} invalid manifests filtered out`
        );
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
  if (cached) {
    return cached;
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
      // Don't cache invalid manifests
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
    pluginCache.set(manifestUrl, plugin);

    return plugin;
  } catch (err) {
    console.error(`[Marketplace] Failed to fetch community plugin: ${manifestUrl}`, err);
    // Don't cache errors
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
  console.log('[Marketplace] Plugin cache cleared');
}

// Get plugin by name from list
export function getPluginByName(plugins: MarketplacePlugin[], name: string): MarketplacePlugin | undefined {
  return plugins.find(p => p.manifest.name === name);
}

// Cleanup marketplace resources (call on app shutdown)
export function cleanupMarketplace(): void {
  pluginCache.stopCleanup();
  pluginCache.clear();
  console.log('[Marketplace] Marketplace cleanup complete');
}

// Get cache statistics for debugging
export function getCacheStats(): { size: number; maxSize: number } {
  return pluginCache.getStats();
}
