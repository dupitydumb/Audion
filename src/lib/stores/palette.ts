import { writable, derived } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { currentTrack } from "$lib/stores/player";
import { convertFileSrc } from "$lib/api/tauri";
import { resolveTrackCover } from "$lib/stores/library";
import { customArtworks } from "$lib/stores/customArtwork";
import { meshSettings } from "$lib/stores/meshSettings";

export interface PaletteColor {
  hex: string;
  luminance: number;
  isDark: boolean;
  weight: number;
}

// ranked by true dominance (most of the image first), light and dark alike
export const albumPalette = writable<PaletteColor[]>([]);
const cache = new Map<string, PaletteColor[]>();
const inFlightPrewarms = new Map<string, Promise<PaletteColor[] | null>>();

/**
 * Clean neutral slate/monochrome palette for grayscale or near-grayscale covers.
 */
export const NEUTRAL_GRAYSCALE_PALETTE: PaletteColor[] = [
  { hex: "#121212", luminance: 0x12 / 255, isDark: true, weight: 0.4 },
  { hex: "#1e1e1e", luminance: 0x1e / 255, isDark: true, weight: 0.3 },
  { hex: "#2d2d2d", luminance: 0x2d / 255, isDark: true, weight: 0.2 },
  { hex: "#ffffff", luminance: 1.0, isDark: false, weight: 0.1 },
];

/**
 * Calculates chroma and saturation (HSV & HSL) for a given hex color string.
 */
export function getChromaAndSaturation(hex: string): {
  chroma: number;
  saturation: number;
  saturationHsl: number;
} {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return { chroma: 0, saturation: 0, saturationHsl: 0 };

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return { chroma: 0, saturation: 0, saturationHsl: 0 };

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const saturation = max === 0 ? 0 : chroma / max;

  const l = (max + min) / 510;
  const saturationHsl =
    max === min ? 0 : l > 0.5 ? chroma / (510 - (max + min)) : chroma / (max + min);

  return { chroma, saturation, saturationHsl };
}

/**
 * Grayscale Chroma Guard:
 * When album art has low chroma (chroma <= 12 or saturation <= 0.08 across dominant swatches),
 * treat it as near-grayscale to avoid sickly/muddy tinted accents.
 */
export function isNearGrayscale(palette: PaletteColor[]): boolean {
  if (!palette || palette.length === 0) return false;

  const dominant = palette.filter((c) => c.weight >= 0.08);
  const swatchesToCheck = dominant.length > 0 ? dominant : palette.slice(0, 3);

  return swatchesToCheck.every((c) => {
    const { chroma, saturation, saturationHsl } = getChromaAndSaturation(c.hex);
    return chroma <= 12 || saturation <= 0.08 || saturationHsl <= 0.08;
  });
}

/**
 * Applies the Grayscale Chroma Guard to a palette, replacing it with the clean
 * neutral slate/monochrome palette if near-grayscale.
 */
export function applyGrayscaleChromaGuard(palette: PaletteColor[]): PaletteColor[] {
  if (palette.length > 0 && isNearGrayscale(palette)) {
    return NEUTRAL_GRAYSCALE_PALETTE.map((c) => ({ ...c }));
  }
  return palette;
}

function normalizePalette(
  raw: { hex: string; luminance: number; is_dark: boolean; weight: number }[]
): PaletteColor[] {
  const colors = raw.map((c) => ({
    hex: c.hex,
    luminance: c.luminance,
    isDark: c.is_dark,
    weight: c.weight,
  }));
  return applyGrayscaleChromaGuard(colors);
}

/**
 * Pre-warms the cover art and palette extraction for a given cover URL or file path.
 * Caches the resulting PaletteColor array so subsequent palette lookups resolve instantly.
 */
export async function prewarmPalette(coverUrl: string): Promise<PaletteColor[] | null> {
  if (!coverUrl) return null;

  if (cache.has(coverUrl)) {
    return cache.get(coverUrl)!;
  }

  if (inFlightPrewarms.has(coverUrl)) {
    return await inFlightPrewarms.get(coverUrl)!;
  }

  const promise = (async (): Promise<PaletteColor[] | null> => {
    try {
      let raw: { hex: string; luminance: number; is_dark: boolean; weight: number }[] | null = null;

      const isHttp = coverUrl.startsWith("http://") || coverUrl.startsWith("https://");
      const isData = coverUrl.startsWith("data:");
      const isAsset = coverUrl.startsWith("asset://") || coverUrl.startsWith("tauri://");

      // If it looks like a local file path, try direct IPC extraction first
      if (!isHttp && !isData && !isAsset) {
        try {
          raw = await invoke("extract_palette_from_path", {
            filePath: coverUrl,
          });
        } catch {
          // Fall through to fetch
        }
      }

      if (!raw) {
        const res = await fetch(coverUrl).catch(() => null);
        if (res && res.ok) {
          const bytes = await res.arrayBuffer();
          raw = await invoke("extract_palette", {
            imageBytes: Array.from(new Uint8Array(bytes)),
          });
        }
      }

      if (raw && raw.length > 0) {
        const palette = normalizePalette(raw);
        cache.set(coverUrl, palette);

        // Also map converted asset URL if coverUrl was a file path
        if (!isHttp && !isData && !isAsset) {
          try {
            const converted = convertFileSrc(coverUrl);
            if (converted && converted !== coverUrl) {
              cache.set(converted, palette);
            }
          } catch {
            // ignore
          }
        }

        return palette;
      }

      return null;
    } catch (e) {
      console.warn("prewarmPalette failed for:", coverUrl, e);
      return null;
    } finally {
      inFlightPrewarms.delete(coverUrl);
    }
  })();

  inFlightPrewarms.set(coverUrl, promise);
  return await promise;
}

let currentGen = 0;

// re-extract when the track changes or the user changes its artwork
const paletteSource = derived([currentTrack, customArtworks], ([track]) => track);
let lastTrackId: number | null = null;
let lastCoverSrc: string | null = null;

paletteSource.subscribe(async (track) => {
  if (!track) {
    ++currentGen;
    lastTrackId = null;
    lastCoverSrc = null;
    albumPalette.set([]);
    return;
  }

  const coverSrc = resolveTrackCover(track);

  // currentTrack emits often (e.g. cover_url updates)
  // skip if nothing visual changed
  // must happen before bumping currentGen, or an in-flight extraction would be discarded
  if (track.id === lastTrackId && coverSrc === lastCoverSrc) return;
  lastTrackId = track.id;
  lastCoverSrc = coverSrc;

  const gen = ++currentGen;

  if (!coverSrc) {
    albumPalette.set([]);
    return;
  }

  if (cache.has(coverSrc)) {
    albumPalette.set(cache.get(coverSrc)!);
    return;
  }

  if (inFlightPrewarms.has(coverSrc)) {
    const prewarmed = await inFlightPrewarms.get(coverSrc);
    if (gen !== currentGen) return;
    if (prewarmed) {
      albumPalette.set(prewarmed);
      return;
    }
  }

  try {
    let raw: { hex: string; luminance: number; is_dark: boolean; weight: number }[];

    if (track.track_cover_path && coverSrc === convertFileSrc(track.track_cover_path)) {
      // preferred path: only a short file path string crosses the IPC boundary
      // rust reads the file itself
      raw = await invoke("extract_palette_from_path", {
        filePath: track.track_cover_path,
      });
    } else {
      // fallback for covers with no local file:
      // legacy base64 storage or a remote cover_url
      let res = await fetch(coverSrc).catch(() => null);
      if (!res || !res.ok) {
        // If Google CDN failed with 429 or network error and track has external_id, try YouTube fallback thumbnail
        if (track.source_type === 'youtube' && track.external_id && !coverSrc.includes('i.ytimg.com')) {
          const ytFallback = `https://i.ytimg.com/vi/${track.external_id}/hqdefault.jpg`;
          res = await fetch(ytFallback).catch(() => null);
        }
      }
      if (!res || !res.ok) {
        // Silent graceful fallback if cover cannot be fetched or rate-limited
        // a newer track may have taken over while we were fetching: don't wipe its palette
        if (gen !== currentGen) return;
        // forget this cover so the next currentTrack emission retries it
        lastCoverSrc = null;
        albumPalette.set([]);
        return;
      }
      const bytes = await res.arrayBuffer();
      raw = await invoke("extract_palette", {
        imageBytes: Array.from(new Uint8Array(bytes)),
      });
    }

    if (gen !== currentGen) return;

    const palette = normalizePalette(raw);
    cache.set(coverSrc, palette);
    albumPalette.set(palette);
  } catch (e) {
    if (gen !== currentGen) return;
    console.error("Palette extraction failed:", e);
    // forget this cover so the next currentTrack emission retries it
    // (otherwise the skip check above would leave the palette empty after a transient failure, e.g. a 429)
    lastCoverSrc = null;
    albumPalette.set([]);
  }
});

// which colors feed the fullscreen mesh background:
// true: the actual top colors by dominance, whatever their lightness
// dark: restrict to darker swatches only
export type MeshColorMode = "true" | "dark";

function pickFour(hexes: string[]): string[] {
  const fallback = "#0a0a0a";
  switch (hexes.length) {
    case 0:
      return [fallback, fallback, fallback, fallback];
    case 1:
      return [hexes[0], hexes[0], hexes[0], hexes[0]];
    case 2:
      return [hexes[1], hexes[0], hexes[1], hexes[0]];
    case 3:
      return [hexes[1], hexes[0], hexes[1], hexes[2]];
    default:
      return [hexes[1], hexes[0], hexes[hexes.length - 1], hexes[hexes.length - 2]];
  }
}

export const meshColors = derived(
  [albumPalette, meshSettings],
  ([palette, settings]) => {
    const mode: MeshColorMode = settings.colorMode ?? "true";
    const source =
      mode === "dark" ? palette.filter((c) => c.isDark) : palette;
    return pickFour(source.map((c) => c.hex));
  }
);