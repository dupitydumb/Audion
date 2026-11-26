import { writable } from 'svelte/store';
import { proxyFetch } from '../network';

interface UpdateState {
    hasUpdate: boolean;
    latestRelease: any | null;
    checking: boolean;
    error: string | null;
}

/**
 * Returns > 0 if `a` is strictly newer than `b` according to SemVer
 * (including pre-release precedence: 1.5.2 > 1.5.2-beta > 1.5.1).
 */
function compareSemver(a: string, b: string): number {
    const parse = (v: string) => {
        const clean = v.trim().replace(/^v/i, '').split('+')[0];
        const dashIdx = clean.indexOf('-');
        const coreStr = dashIdx === -1 ? clean : clean.slice(0, dashIdx);
        const preStr = dashIdx === -1 ? '' : clean.slice(dashIdx + 1);
        const core = coreStr.split('.').map((n) => parseInt(n, 10) || 0);
        const pre = preStr ? preStr.split('.') : [];
        return { core, pre };
    };

    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.core.length, pb.core.length, 3);
    for (let i = 0; i < len; i++) {
        const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
        if (diff !== 0) return diff;
    }

    // Equal core versions: stable (empty pre) > pre-release
    if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
    if (pa.pre.length === 0) return 1;
    if (pb.pre.length === 0) return -1;

    const preLen = Math.max(pa.pre.length, pb.pre.length);
    for (let i = 0; i < preLen; i++) {
        const ia = pa.pre[i];
        const ib = pb.pre[i];
        if (ia === undefined) return -1;
        if (ib === undefined) return 1;
        const na = /^\d+$/.test(ia) ? Number(ia) : NaN;
        const nb = /^\d+$/.test(ib) ? Number(ib) : NaN;
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
            if (na !== nb) return na - nb;
        } else if (!Number.isNaN(na)) {
            return -1;
        } else if (!Number.isNaN(nb)) {
            return 1;
        } else if (ia !== ib) {
            return ia < ib ? -1 : 1;
        }
    }
    return 0;
}

function createUpdateStore() {
    const { subscribe, set, update } = writable<UpdateState>({
        hasUpdate: false,
        latestRelease: null,
        checking: false,
        error: null
    });

    return {
        subscribe,
        checkUpdate: async () => {
            update(s => ({ ...s, checking: true, error: null }));
            try {
                const data = await proxyFetch<any>("https://api.github.com/repos/dupitydumb/Audion/releases/latest");

                    // transform tag to version number (remove 'v' prefix if present)
                    const latestVersion = data.tag_name.replace(/^v/, '');
                    const currentVersion = __APP_VERSION__.replace(/^v/, '');

                    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

                    set({
                        hasUpdate,
                        latestRelease: data,
                        checking: false,
                        error: null
                    });
            } catch (error) {
                console.error("Failed to check version:", error);
                update(s => ({
                    ...s,
                    checking: false,
                    error: error instanceof Error ? error.message : String(error)
                }));
            }
        }
    };
}

export const updates = createUpdateStore();
