// Lyrics API constants

export const API = {
    BASE_URL: 'https://lrclib.net/api',
    SEARCH_ENDPOINT: '/search',
    GET_ENDPOINT: '/get',
    TIMEOUT: 10000,
    RETRY_ATTEMPTS: 2,
    RETRY_DELAY: 1000
};

export const CACHE_CONFIG = {
    EXPIRY_TIME: 24 * 60 * 60 * 1000, // 24 hours
    MAX_SIZE: 100
};

export const FILTER_WORDS = {
    BASIC: [
        'official', 'video', 'audio', 'lyrics', 'lyric', 'hd', '4k',
        'music', 'mv', 'visualizer', 'remix', 'cover', 'live',
        'acoustic', 'version', 'edit', 'extended'
    ]
};

export const ERROR_MESSAGES = {
    NO_LYRICS: 'No lyrics found for this track',
    NETWORK_ERROR: 'Network error. Please check your connection.',
    API_ERROR: 'Failed to fetch lyrics. Please try again.'
};
