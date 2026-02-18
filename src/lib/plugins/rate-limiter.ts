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
    private consumedTotal: number = 0; // Track total consumed for stats

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
            this.consumedTotal += tokens;
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
     * Get time until next token is available (in milliseconds)
     */
    getTimeUntilNextToken(): number {
        if (this.tokens >= 1) return 0;

        const tokensNeeded = 1 - this.tokens;
        return (tokensNeeded / this.config.refillRate) * 1000;
    }

    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.tokens = this.config.initialTokens;
        this.lastRefill = Date.now();
        this.consumedTotal = 0;
    }

    /**
     * Get statistics about rate limiter usage
     */
    getStats(): {
        currentTokens: number;
        maxTokens: number;
        refillRate: number;
        totalConsumed: number;
        percentAvailable: number;
    } {
        const current = this.getTokens();
        return {
            currentTokens: current,
            maxTokens: this.config.maxTokens,
            refillRate: this.config.refillRate,
            totalConsumed: this.consumedTotal,
            percentAvailable: (current / this.config.maxTokens) * 100
        };
    }

    /**
     * Check if tokens are available without consuming
     */
    hasTokens(tokens: number = 1): boolean {
        this.refill();
        return this.tokens >= tokens;
    }
}

// Predefined rate limiters for different operations
export const RATE_LIMITS = {
    API_CALLS: { maxTokens: 1000, refillRate: 1000 / 60 },    // 1000 calls per minute - Increased for batch ops
    STORAGE_WRITES: { maxTokens: 50, refillRate: 50 / 60 },   // 50 writes per minute
    EVENTS: { maxTokens: 1000, refillRate: 1000 / 60 }        // 1000 events per minute
} as const;
