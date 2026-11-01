import { writable, derived } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { currentTrack } from "$lib/stores/player";
import { getTrackCoverSrc } from "$lib/api/tauri";
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

function normalizePalette(
  raw: { hex: string; luminance: number; is_dark: boolean; weight: number }[]
): PaletteColor[] {
  return raw.map((c) => ({
    hex: c.hex,
    luminance: c.luminance,
    isDark: c.is_dark,
    weight: c.weight,
  }));
}

let currentGen = 0;

currentTrack.subscribe(async (track) => {
  const gen = ++currentGen;

  if (!track) {
    albumPalette.set([]);
    return;
  }

  const coverSrc = getTrackCoverSrc(track);
  if (!coverSrc) {
    albumPalette.set([]);
    return;
  }

  if (cache.has(coverSrc)) {
    albumPalette.set(cache.get(coverSrc)!);
    return;
  }

  try {
    let raw: { hex: string; luminance: number; is_dark: boolean; weight: number }[];

    if (track.track_cover_path) {
      // preferred path: only a short file path string crosses the IPC boundary
      // rust reads the file itself
      raw = await invoke("extract_palette_from_path", {
        filePath: track.track_cover_path,
      });
    } else {
      // fallback for covers with no local file:
      // legacy base64 storage or a remote cover_url
      const res = await fetch(coverSrc);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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