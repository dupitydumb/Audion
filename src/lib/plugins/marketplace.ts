// Plugin registry and marketplace client
import type { AudionPluginManifest } from './schema';
import { validateManifest, validateManifests } from './schema';
import {
  CATEGORY_TO_CAPABILITY,
  getCapabilities,
  getCapabilityLabel,
  getCategoryLabel,
  normalizeCategory,
} from './categories';
import { proxyFetch } from '../network';

export interface MarketplacePlugin {
  manifest: AudionPluginManifest;
  curated: boolean;
  repo: string;
  manifest_url: string;
  stars?: number;
  downloads?: number;
  verified?: boolean;
  lastUpdated?: string;
  sha256?: string;
  registryName?: string;
}

export interface CommunityRegistry {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  isDefault?: boolean;
}

export const DEFAULT_REGISTRIES: CommunityRegistry[] = [
  {
    id: 'official',
    name: 'Official Audion Registry',
    url: 'https://raw.githubusercontent.com/dupitydumb/audion-plugins/main/registry/main/registry.json',
    enabled: true,
    isDefault: true,
  },
];

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

// Resolve icon URL if relative using manifest_url or repository path
export function resolvePluginIconUrl(plugin: { manifest?: AudionPluginManifest; manifest_url?: string; repo?: string }): string | undefined {
  const manifest = plugin.manifest;
  if (!manifest || !manifest.icon) return undefined;
  if (
    manifest.icon.startsWith('http') ||
    manifest.icon.startsWith('data:') ||
    manifest.icon.trim().startsWith('<svg')
  ) {
    return undefined;
  }

  // 1. If manifest_url is available, resolve relative to it
  if (plugin.manifest_url && isValidUrl(plugin.manifest_url)) {
    try {
      const baseUrl = plugin.manifest_url.substring(0, plugin.manifest_url.lastIndexOf('/') + 1);
      return new URL(manifest.icon, baseUrl).href;
    } catch {}
  }

  // 2. If repo URL or owner/repo is available, resolve to raw GitHub URL
  if (plugin.repo) {
    const match =
      plugin.repo.match(/github\.com\/([^/]+)\/([^/]+)/) ||
      plugin.repo.match(/^([^/]+)\/([^/]+)$/);
    if (match) {
      const [, owner, repo] = match;
      const cleanRepo = repo.replace(/\.git$/, '').replace(/\/$/, '');
      const cleanIcon = manifest.icon.replace(/^\.?\//, '');
      return `https://raw.githubusercontent.com/${owner}/${cleanRepo}/main/${cleanIcon}`;
    }
  }

  return undefined;
}

// Fetch with proxy
async function fetchWithProxy<T>(url: string): Promise<T> {
  return proxyFetch<T>(url);
}

// Fetch plugins from a single registry endpoint
export async function fetchRegistry(registry: CommunityRegistry): Promise<MarketplacePlugin[]> {
  if (!registry.enabled || !isValidUrl(registry.url)) return [];

  try {
    const noCacheUrl = `${registry.url}?t=${Date.now()}`;
    const data: RegistryData = await fetchWithProxy<RegistryData>(noCacheUrl);

    if (!data || !Array.isArray(data.plugins)) {
      console.warn(`[Marketplace] Registry ${registry.name} returned invalid format`);
      return [];
    }

    const validManifests = validateManifests(data.plugins.map((p) => p.manifest));
    return data.plugins
      .filter((p) => validManifests.includes(p.manifest as AudionPluginManifest))
      .map((p) => {
        const iconUrl = resolvePluginIconUrl(p);
        const manifest = iconUrl && !p.manifest.icon_url ? { ...p.manifest, icon_url: iconUrl } : p.manifest;
        return {
          ...p,
          manifest,
          curated: !!registry.isDefault,
          registryName: registry.name,
        };
      });
  } catch (err) {
    console.warn(`[Marketplace] Failed to fetch registry '${registry.name}' from ${registry.url}:`, err);
    return [];
  }
}

// Fetch and merge plugins from multiple registries
export async function fetchAllRegistries(registries: CommunityRegistry[]): Promise<MarketplacePlugin[]> {
  const active = registries.filter((r) => r.enabled);
  if (active.length === 0) return [];

  const results = await Promise.allSettled(active.map((reg) => fetchRegistry(reg)));
  const merged: MarketplacePlugin[] = [];
  const seenRepos = new Set<string>();

  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const plugin of res.value) {
        const key = plugin.manifest.name || plugin.repo;
        if (!seenRepos.has(key)) {
          seenRepos.add(key);
          merged.push(plugin);
        }
      }
    }
  }

  return merged;
}

// Fetch curated registry
export async function fetchCuratedRegistry(): Promise<MarketplacePlugin[]> {
  // Try local registry first (for development)
  if (localRegistryPath) {
    try {
      const data: RegistryData = await fetchWithProxy<RegistryData>(localRegistryPath);

        // Batch validate all manifests
        const validManifests = validateManifests(data.plugins.map(p => p.manifest));

        // Map back to plugins
        return data.plugins
          .filter(p => validManifests.includes(p.manifest as AudionPluginManifest))
          .map(p => {
            const iconUrl = resolvePluginIconUrl(p);
            const manifest = iconUrl && !p.manifest.icon_url ? { ...p.manifest, icon_url: iconUrl } : p.manifest;
            return { ...p, manifest, curated: true };
          });
    } catch (err) {
      console.warn('[Marketplace] Local registry failed:', err);
    }
  }

  // Try remote registries
  for (const url of CURATED_REGISTRY_URLS) {
    try {
      // Append timestamp to prevent caching
      const noCacheUrl = `${url}?t=${Date.now()}`;
      const data: RegistryData = await fetchWithProxy<RegistryData>(noCacheUrl);

      // Batch validate all manifests
      const validManifests = validateManifests(data.plugins.map(p => p.manifest));

      // Map back to plugins
      const validPlugins = data.plugins
        .filter(p => validManifests.includes(p.manifest as AudionPluginManifest))
        .map(p => {
          const iconUrl = resolvePluginIconUrl(p);
          const manifest = iconUrl && !p.manifest.icon_url ? { ...p.manifest, icon_url: iconUrl } : p.manifest;
          return { ...p, manifest, curated: true };
        });

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

// Fetch a community plugin from manifest URL or repository URL
export async function fetchCommunityPlugin(url: string): Promise<MarketplacePlugin | null> {
  // Convert GitHub repository URL to raw manifest URL if needed
  let manifestUrl = url;

  // Check if it's a GitHub repo URL (not already a raw URL)
  if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
    // Extract owner/repo from URL
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) {
      const [, owner, repo] = match;
      // Remove trailing slash and .git if present
      const cleanRepo = repo.replace(/\.git$/, '').replace(/\/$/, '');
      // Default to main branch (you could also detect the default branch)
      manifestUrl = `https://raw.githubusercontent.com/${owner}/${cleanRepo}/main/plugin.json`;
      console.log(`[Marketplace] Converted repo URL to manifest URL: ${manifestUrl}`);
    }
  }

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
    const manifest = await fetchWithProxy<any>(manifestUrl);

    // Validate manifest
    if (!validateManifest(manifest)) {
      console.warn(`[Marketplace] Invalid community manifest: ${manifestUrl}`);
      // Don't cache invalid manifests
      return null;
    }

    // Resolve icon URL if it's relative
    if (manifest.icon && 
        !manifest.icon.startsWith('http') && 
        !manifest.icon.startsWith('data:') &&
        !manifest.icon.trim().startsWith('<svg')) {
      try {
        // manifestUrl is the direct URL to plugin.json
        const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
        manifest.icon_url = new URL(manifest.icon, baseUrl).href;
      } catch (err) {
        console.warn('[Marketplace] Failed to resolve icon URL:', err);
      }
    }

    const plugin: MarketplacePlugin = {
      manifest,
      curated: false,
      repo: url, // Store original repo URL
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
export async function fetchMarketplacePlugins(
  communityUrls: string[] = [],
  registries?: CommunityRegistry[]
): Promise<MarketplacePlugin[]> {
  const results: MarketplacePlugin[] = [];

  // Fetch plugins from all configured registries or default curated
  if (registries && registries.length > 0) {
    const registryPlugins = await fetchAllRegistries(registries);
    results.push(...registryPlugins);
  } else {
    const curated = await fetchCuratedRegistry();
    results.push(...curated);
  }

  // Fetch community plugins in parallel
  const communityPromises = communityUrls.map((url) => fetchCommunityPlugin(url));
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
      m.category?.toLowerCase().includes(q) ||
      getCategoryLabel(m.category).toLowerCase().includes(q) ||
      getCapabilities(m).some(cap => getCapabilityLabel(cap).toLowerCase().includes(q))
    );
  });
}

// Filter plugins by category (canonical category or derived capability)
export function filterByCategory(plugins: MarketplacePlugin[], category: string): MarketplacePlugin[] {
  if (!category || category === 'all') return plugins;
  const target = normalizeCategory(category);
  const targetCap = target ? CATEGORY_TO_CAPABILITY[target] : undefined;
  return plugins.filter(p => {
    const canonical = normalizeCategory(p.manifest.category) ?? p.manifest.category;
    if (canonical === (target ?? category)) return true;
    return targetCap ? getCapabilities(p.manifest).includes(targetCap) : false;
  });
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
