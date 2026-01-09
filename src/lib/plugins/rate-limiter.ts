// Token bucket rate limiter for plugin API calls
// Prevents abuse and ensures fair resource usage

export interface RateLimiterConfig {
    maxTokens: number;      // Maximum tokens in bucket
    refillRate: number;     // Tokens added per second
    initialTokens?: number; // Starting tokens (default: maxTokens)
}

export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private config: Required<RateLimiterConfig>;

    constructor(config: RateLimiterConfig) {
        this.config = {
            maxTokens: config.maxTokens,
            refillRate: config.refillRate,
            initialTokens: config.initialTokens ?? config.maxTokens
        };
        this.tokens = this.config.initialTokens;
        this.lastRefill = Date.now();
    }

    /**
     * Try to consume tokens from the bucket
     * @param tokens Number of tokens to consume (default: 1)
     * @returns true if tokens were consumed, false if rate limited
     */
    tryConsume(tokens: number = 1): boolean {
        this.refill();

        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return true;
        }

        return false;
    }

    /**
     * Refill tokens based on elapsed time
     */
    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
        const tokensToAdd = elapsed * this.config.refillRate;

        this.tokens = Math.min(this.tokens + tokensToAdd, this.config.maxTokens);
        this.lastRefill = now;
    }

    /**
     * Get current token count
     */
    getTokens(): number {
        this.refill();
        return Math.floor(this.tokens);
    }

    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.tokens = this.config.initialTokens;
        this.lastRefill = Date.now();
    }
}

// Predefined rate limiters for different operations
export const RATE_LIMITS = {
    API_CALLS: { maxTokens: 100, refillRate: 100 / 60 },      // 100 calls per minute
    STORAGE_WRITES: { maxTokens: 50, refillRate: 50 / 60 },   // 50 writes per minute
    EVENTS: { maxTokens: 1000, refillRate: 1000 / 60 }        // 1000 events per minute
} as const;
