import { writable } from "svelte/store";

const browser = typeof window !== "undefined";

export interface MeshSettings {
  enabled: boolean;
  speed: number; // 0.25 - 2.5, multiplier on animation time
  blur: number; // px, 0 - 100
  opacity: number; // 0 - 1
  saturation: number; // 0.5 - 4
  quality: number; // internal render resolution (px per axis), 16 - 256
  spread: number; // orbit radius: how far each blob wanders from its anchor, 0.05 - 0.4
  sharpness: number; // blob edge falloff exponent, 1.5 - 8 (lower => softer blend, higher => crisper blobs)
}

export const DEFAULT_MESH_SETTINGS: MeshSettings = {
  enabled: true,
  speed: 1,
  blur: 50,
  opacity: 0.85,
  saturation: 1.4,
  quality: 48,
  spread: 0.22,
  sharpness: 3.5,
};

const STORAGE_KEY = "audion:mesh-settings";

function load(): MeshSettings {
  if (!browser) return { ...DEFAULT_MESH_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MESH_SETTINGS };
    return { ...DEFAULT_MESH_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MESH_SETTINGS };
  }
}

function createMeshSettingsStore() {
  const store = writable<MeshSettings>(load());
  const { subscribe, set, update } = store;

  if (browser) {
    subscribe((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // ignore write failures
      }
    });
  }

  return {
    subscribe,
    set,
    update,
    reset: () => set({ ...DEFAULT_MESH_SETTINGS }),
  };
}

export const meshSettings = createMeshSettingsStore();