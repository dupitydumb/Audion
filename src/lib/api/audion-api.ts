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
    'http://15.235.142.81:3000',
    'http://localhost:3000'
];

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
