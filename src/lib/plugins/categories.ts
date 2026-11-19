// Human-readable labels and canonical taxonomy for plugin metadata.
// Manifests may use arbitrary category strings; this maps them to one of
// CATEGORIES (or a Title Case fallback) and derives capability badges.

import type { AudionPluginManifest, PluginCapability } from './schema';

export const CATEGORIES = [
  'streaming',
  'metadata',
  'lyrics',
  'library',
  'integration',
  'appearance',
  'utility',
] as const;

export type CanonicalCategory = typeof CATEGORIES[number];

export const CAPABILITIES = ['stream', 'metadata', 'lyrics'] as const;

/** Translator wrapper: `(key, fallback) => string`, e.g. `$_`. */
export type Translate = (key: string, fallback: string) => string;

export const CATEGORY_ALIASES: Record<string, CanonicalCategory> = {
  audio: 'streaming',
  ui: 'appearance',
  theme: 'appearance',
  social: 'integration',
  sync: 'integration',
  tool: 'utility',
  tools: 'utility',
};

export const CATEGORY_TO_CAPABILITY: Partial<Record<CanonicalCategory, PluginCapability>> = {
  streaming: 'stream',
  metadata: 'metadata',
  lyrics: 'lyrics',
};

const CATEGORY_LABELS: Record<CanonicalCategory, string> = {
  streaming: 'Streaming',
  metadata: 'Metadata',
  lyrics: 'Lyrics',
  library: 'Library',
  integration: 'Integration',
  appearance: 'Appearance',
  utility: 'Utility',
};

const CAPABILITY_LABELS: Record<PluginCapability, string> = {
  stream: 'Stream',
  metadata: 'Metadata',
  lyrics: 'Lyrics',
};

const CAPABILITY_ICONS: Record<PluginCapability, 'radio' | 'search' | 'mic-2'> = {
  stream: 'radio',
  metadata: 'search',
  lyrics: 'mic-2',
};

const TAG_CAPABILITIES: Record<string, PluginCapability> = {
  stream: 'stream',
  streaming: 'stream',
  audio: 'stream',
  playback: 'stream',
  metadata: 'metadata',
  lyrics: 'lyrics',
};

function isCapability(value: unknown): value is PluginCapability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

export function normalizeCategory(raw?: string | null): CanonicalCategory | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if ((CATEGORIES as readonly string[]).includes(key)) return key as CanonicalCategory;
  return CATEGORY_ALIASES[key] ?? null;
}

export function getCategoryLabel(raw: string | null | undefined, t?: Translate): string {
  if (!raw) return '';
  const canon = normalizeCategory(raw);
  if (!canon) return humanizeIdentifier(raw);
  const fallback = CATEGORY_LABELS[canon];
  if (!t) return fallback;
  return t(`pluginManager.category${canon[0].toUpperCase()}${canon.slice(1)}`, fallback);
}

export function getCapabilities(
  m: Pick<AudionPluginManifest, 'provides' | 'tags' | 'category'>
): PluginCapability[] {
  const provides = Array.isArray(m.provides) ? m.provides.filter(isCapability) : [];
  if (provides.length) return Array.from(new Set(provides));

  const tags = Array.isArray(m.tags) ? m.tags : [];
  const fromTags = tags
    .map((tag) => TAG_CAPABILITIES[String(tag).trim().toLowerCase()])
    .filter(isCapability);
  if (fromTags.length) return Array.from(new Set(fromTags));

  const canon = normalizeCategory(m.category);
  const fromCategory = canon ? CATEGORY_TO_CAPABILITY[canon] : undefined;
  return fromCategory ? [fromCategory] : [];
}

/** Capabilities worth a badge: drops the one already implied by the category. */
export function getDisplayCapabilities(
  m: Pick<AudionPluginManifest, 'provides' | 'tags' | 'category'>
): PluginCapability[] {
  const canon = normalizeCategory(m.category);
  const implied = canon ? CATEGORY_TO_CAPABILITY[canon] : undefined;
  return getCapabilities(m).filter((cap) => cap !== implied);
}

export function getCapabilityLabel(cap: PluginCapability, t?: Translate): string {
  const fallback = CAPABILITY_LABELS[cap];
  if (!t) return fallback;
  return t(`pluginManager.capability${cap[0].toUpperCase()}${cap.slice(1)}`, fallback);
}

export function getCapabilityIcon(cap: PluginCapability): 'radio' | 'search' | 'mic-2' {
  return CAPABILITY_ICONS[cap];
}

/** `sample-metadata` → `Sample Metadata`. */
export function humanizeIdentifier(raw: string): string {
  return raw
    .split(/[-_.:\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
