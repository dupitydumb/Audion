// src/lib/stores/skins.ts
// Manages local skins in AppData/skins, folder opening, and active skin state

import { writable, get } from 'svelte/store';
import {
    listLocalSkins,
    openSkinsDir,
    getSkinsDir,
    deleteLocalSkin,
    saveLocalSkin,
    type LocalSkinInfo,
    isTauri,
} from '$lib/api/tauri';
import { theme, parseSkinPackage } from '$lib/stores/theme';
import { addToast } from '$lib/stores/toast';

export const localSkins = writable<LocalSkinInfo[]>([]);
export const skinsLoading = writable<boolean>(false);
export const skinsDirectoryPath = writable<string>('');

/**
 * Re-scans the AppData/skins directory for standalone skin files and theme folders.
 */
export async function refreshLocalSkins(): Promise<void> {
    skinsLoading.set(true);
    try {
        if (isTauri()) {
            const skins = await listLocalSkins();
            // Defensive frontend deduplication by id and name
            const seen = new Set<string>();
            const uniqueSkins: LocalSkinInfo[] = [];
            for (const s of skins) {
                const key = (s.id || s.name || s.path).toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueSkins.push(s);
                }
            }
            localSkins.set(uniqueSkins);
            const dir = await getSkinsDir();
            skinsDirectoryPath.set(dir);
        } else {
            // Web/dev fallback: provide empty or mocked list
            skinsDirectoryPath.set('AppData/skins (desktop only)');
            localSkins.set([]);
        }
    } catch (err) {
        console.error('[SkinsStore] Failed to load local skins:', err);
    } finally {
        skinsLoading.set(false);
    }
}

/**
 * Opens the AppData/skins directory in the OS file explorer (Windows Explorer / Finder / Linux).
 */
export async function openSkinsFolder(): Promise<void> {
    try {
        if (isTauri()) {
            await openSkinsDir();
        } else {
            addToast('Opening folders requires the desktop app', 'info');
        }
    } catch (err) {
        console.error('[SkinsStore] Failed to open skins folder:', err);
        addToast(`Could not open folder: ${err}`, 'error');
    }
}

/**
 * Applies a local skin package to the current theme store.
 */
export function applyLocalSkin(skin: LocalSkinInfo, schemeName?: string): void {
    try {
        const raw = JSON.parse(skin.raw_package);
        const pkg = parseSkinPackage(raw);

        // If a specific scheme was selected, set it as active
        if (schemeName && pkg.schemes && pkg.schemes[schemeName]) {
            pkg.activeScheme = schemeName;
            const targetScheme = pkg.schemes[schemeName];
            pkg.mode = targetScheme.mode;
            pkg.accentColor = targetScheme.accentColor;
            pkg.customColors = { ...pkg.customColors, ...targetScheme.customColors };
        }

        theme.applyPackage({
            skinName: pkg.name,
            skinAuthor: pkg.author,
            skinDescription: pkg.description,
            accentColor: pkg.accentColor,
            mode: pkg.mode,
            customColors: pkg.customColors,
            background: pkg.background,
            animation: pkg.animation,
            customJs: pkg.customJs,
            customCss: pkg.customCss,
            schemes: pkg.schemes,
            activeScheme: pkg.activeScheme,
        });

        if (pkg.customJs) {
            theme.setAllowCustomJs(true);
        }

        addToast(`Applied skin "${pkg.name}"`, 'success');
    } catch (err) {
        console.error('[SkinsStore] Failed to apply skin:', err);
        addToast(`Failed to apply skin: ${err}`, 'error');
    }
}

/**
 * Deletes a local skin file or folder from the disk.
 */
export async function removeLocalSkin(skin: LocalSkinInfo): Promise<boolean> {
    try {
        if (!isTauri()) return false;
        const ok = await deleteLocalSkin(skin.path);
        if (ok) {
            addToast(`Deleted "${skin.name}"`, 'success');
            await refreshLocalSkins();
            return true;
        }
        return false;
    } catch (err) {
        console.error('[SkinsStore] Failed to delete skin:', err);
        addToast(`Failed to delete skin: ${err}`, 'error');
        return false;
    }
}

/**
 * Imports a skin file via file dialog and saves it directly into the AppData/skins folder.
 */
export async function importSkinToFolder(): Promise<void> {
    if (isTauri()) {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            const selected = await open({
                filters: [
                    { name: 'Audion Skin & Theme', extensions: ['audionskin', 'audiotheme', 'json'] },
                ],
                multiple: false,
            });
            if (!selected) return;
            const filePath = typeof selected === 'string' ? selected : selected[0];
            const text = await readTextFile(filePath);
            const parsed = parseSkinPackage(JSON.parse(text));
            const fileName = (parsed.name || 'imported_skin')
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '_');

            await saveLocalSkin(fileName, text);
            await refreshLocalSkins();

            theme.applyPackage(parsed);
            if (parsed.customJs) {
                theme.setAllowCustomJs(true);
            }
            addToast(`Imported and applied "${parsed.name}"`, 'success');
        } catch (err) {
            console.error('[SkinsStore] Import failed:', err);
            addToast(`Import failed: ${err}`, 'error');
        }
    } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.audionskin,.audiotheme,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = parseSkinPackage(JSON.parse(text));
                theme.applyPackage(parsed);
                if (parsed.customJs) theme.setAllowCustomJs(true);
                addToast(`Applied "${parsed.name}"`, 'success');
            } catch (e) {
                addToast(`Invalid skin: ${e}`, 'error');
            }
        };
        input.click();
    }
}

