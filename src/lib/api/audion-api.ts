export interface AudionApiTrack {
    id: string;
    title: string;
    artist: string;
    album: string | null;
    coverUrl: string | null;
    spotifyId: string | null;
    tidalId: string | null;
    durationMs: number | null;
    rank: number;
}

export interface ChartData {
    type: string;
    displayName: string;
    items: AudionApiTrack[];
}

const BASE_URLS = [
    'https://api.audionplayer.com'
];

const TELEMETRY_SECRET = 'audion-telemetry-default-secret-2026';

function getFingerprint(): string {
    if (typeof window === 'undefined') return 'unknown';
    let fp = localStorage.getItem('audion_telemetry_fp');
    if (!fp) {
        fp = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('audion_telemetry_fp', fp);
    }
    return fp;
}

async function tryFetch(path: string) {
    for (const baseUrl of BASE_URLS) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout per source

            const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) return await response.json();
        } catch (e) {
            // Ignore connection errors/timeouts for specific source
            continue;
        }
    }
    return null;
}

export async function fetchAllLatestCharts(): Promise<ChartData[]> {
    const data = await tryFetch('/charts/all/latest');
    return data || [];
}

export async function fetchChart(type: string): Promise<ChartData | null> {
    return await tryFetch(`/charts/${type}`);
}

export async function pingPluginInstall(pluginName: string): Promise<void> {
    // Fire and forget - don't wait for response or handle errors
    const fp = getFingerprint();
    const path = `/telemetry/plugin/install?name=${encodeURIComponent(pluginName)}&fp=${fp}`;
    
    for (const baseUrl of BASE_URLS) {
        try {
            fetch(`${baseUrl}${path}`, {
                method: 'GET',
                headers: {
                    'X-Audion-Secret': TELEMETRY_SECRET
                }
            }).catch(() => { });
        } catch (e) {
            continue;
        }
    }
}
