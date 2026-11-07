// Plugin manifest schema for JS and WASM plugins

// Known categories (plugins can use custom categories too)
export type PluginCategory = 'audio' | 'ui' | 'lyrics' | 'library' | 'utility' | 'appearance' | 'social' | 'sync' | string;
export type PluginType = 'js' | 'wasm';

// Cache validated manifests to avoid re-validation
const validationCache = new WeakMap<object, boolean>();

// Maximum number of validation errors to log per manifest
const MAX_VALIDATION_ERRORS = 3;

// Cross-plugin access control structure
export interface CrossPluginAccess {
  plugin: string;
  methods: string[];
}

export interface AudionPluginManifest {
  name: string;
  safe_name?: string | null; // Explicit safe folder name (optional, falls back to name conversion)
  version: string;
  author: string;
  description?: string | null;
  repo?: string | null;
  manifest_url?: string | null;
  type: PluginType;
  entry: string; // JS: entry .js file, WASM: entry .wasm file
  permissions: string[];
  cross_plugin_access?: CrossPluginAccess[] | null;
  ui_slots?: string[] | null; // UI injection points
  icon?: string | null;
  icon_url?: string | null;
  homepage?: string | null;
  category?: PluginCategory | null;
  tags?: string[] | null;
  min_version?: string | null; // Minimum Audion version required
  license?: string | null;
}

// Permission definitions with human-readable descriptions
export const PLUGIN_PERMISSIONS: Record<string, string> = {
  'player:control': 'Control playback (play, pause, seek, skip)',
  'player:read': 'Read current playback state and queue',
  'library:read': 'Read library tracks, albums, and playlists',
  'library:write': 'Modify library and playlists',
  'ui:inject': 'Inject custom UI elements into the app',
  'network:fetch': 'Make network requests to external services',
  'storage:local': 'Store and read local plugin data',
  'lyrics:read': 'Read lyrics data',
  'lyrics:write': 'Modify and save lyrics',
  'system:notify': 'Show system notifications',
} as const;

export const ALL_PERMISSIONS = Object.keys(PLUGIN_PERMISSIONS);

// Validate manifest schema (with caching)
export function validateManifest(manifest: unknown): manifest is AudionPluginManifest {
  if (!manifest || typeof manifest !== 'object') return false;

  // Check cache first
  if (validationCache.has(manifest)) {
    return validationCache.get(manifest)!;
  }

  const m = manifest as Record<string, unknown>;
  const errors: string[] = [];

  // Required fields
  if (typeof m.name !== 'string' || !m.name) {
    errors.push('Missing or invalid name');
  }
  if (typeof m.version !== 'string' || !m.version) {
    errors.push('Missing or invalid version');
  }
  if (typeof m.author !== 'string' || !m.author) {
    errors.push('Missing or invalid author');
  }
  if (m.type !== 'js' && m.type !== 'wasm') {
    errors.push(`Invalid type: ${m.type} (must be 'js' or 'wasm')`);
  }
  if (typeof m.entry !== 'string' || !m.entry) {
    errors.push('Missing or invalid entry');
  }
  if (!Array.isArray(m.permissions)) {
    errors.push('Permissions must be an array');
  } else {
    // Validate permissions are strings
    for (const perm of m.permissions) {
      if (typeof perm !== 'string') {
        errors.push(`Invalid permission: ${perm}`);
        break; // Don't spam errors
      }
    }
  }

  // Optional field types (allow null or undefined)
  if (m.safe_name != null && typeof m.safe_name !== 'string') {
    errors.push('safe_name must be a string');
  }
  if (m.description != null && typeof m.description !== 'string') {
    errors.push('Description must be a string');
  }
  if (m.repo != null && typeof m.repo !== 'string') {
    errors.push('Repo must be a string');
  }
  if (m.manifest_url != null && typeof m.manifest_url !== 'string') {
    errors.push('manifest_url must be a string');
  }
  if (m.icon != null && typeof m.icon !== 'string') {
    errors.push('Icon must be a string');
  }
  if (m.icon_url != null && typeof m.icon_url !== 'string') {
    errors.push('icon_url must be a string');
  }
  if (m.homepage != null && typeof m.homepage !== 'string') {
    errors.push('Homepage must be a string');
  }
  if (m.license != null && typeof m.license !== 'string') {
    errors.push('License must be a string');
  }
  if (m.min_version != null && typeof m.min_version !== 'string') {
    errors.push('min_version must be a string');
  }
  if (m.category != null && typeof m.category !== 'string') {
    errors.push('Category must be a string');
  }
  if (m.ui_slots != null && !Array.isArray(m.ui_slots)) {
    errors.push('ui_slots must be an array');
  }
  if (m.tags != null && !Array.isArray(m.tags)) {
    errors.push('Tags must be an array');
  }
  if (m.cross_plugin_access != null) {
    if (!Array.isArray(m.cross_plugin_access)) {
      errors.push('cross_plugin_access must be an array');
    } else {
      // Validate structure of each item
      for (const access of m.cross_plugin_access) {
        if (typeof access !== 'object' || access === null ||
          typeof access.plugin !== 'string' ||
          !Array.isArray(access.methods)) {
          errors.push('Invalid cross_plugin_access item structure (must have plugin: string, methods: string[])');
          break;
        }
      }
    }
  }

  const isValid = errors.length === 0;

  // Log errors (limited)
  if (!isValid && errors.length > 0) {
    const displayErrors = errors.slice(0, MAX_VALIDATION_ERRORS);
    console.warn(
      `[Schema] Validation failed for manifest "${m.name || 'unknown'}":`,
      displayErrors.join(', '),
      errors.length > MAX_VALIDATION_ERRORS ? `... and ${errors.length - MAX_VALIDATION_ERRORS} more` : ''
    );
  }

  // Cache result (WeakMap auto-cleans when manifest object is GC'd)
  validationCache.set(manifest, isValid);

  return isValid;
}

// Validate multiple manifests efficiently (deduplicates)
export function validateManifests(manifests: unknown[]): AudionPluginManifest[] {
  const seen = new Set<object>();
  const valid: AudionPluginManifest[] = [];

  for (const manifest of manifests) {
    // Skip duplicates (same object reference)
    if (typeof manifest === 'object' && manifest !== null && seen.has(manifest)) {
      continue;
    }

    if (validateManifest(manifest)) {
      valid.push(manifest as AudionPluginManifest);
      if (typeof manifest === 'object' && manifest !== null) {
        seen.add(manifest);
      }
    }
  }

  return valid;
}

// Check if permission is valid
export function isValidPermission(permission: string): boolean {
  return permission in PLUGIN_PERMISSIONS;
}

// Get permission description
export function getPermissionDescription(permission: string): string {
  return PLUGIN_PERMISSIONS[permission] || 'Unknown permission';
}

// Example manifest
export const exampleManifest: AudionPluginManifest = {
  name: 'Sample Plugin',
  version: '1.0.0',
  author: 'Community',
  description: 'A sample plugin for Audion',
  repo: 'https://github.com/audion-plugins/sample-plugin',
  manifest_url: 'https://raw.githubusercontent.com/audion-plugins/sample-plugin/main/plugin.json',
  type: 'js',
  entry: 'index.js',
  permissions: ['player:control', 'ui:inject'],
  ui_slots: ['sidebar', 'playerbar'],
  icon: 'icon.png',
  homepage: 'https://audion-plugins.github.io/sample-plugin',
  category: 'utility',
  tags: ['sample', 'demo'],
  license: 'MIT'
};