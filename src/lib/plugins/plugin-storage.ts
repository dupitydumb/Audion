// Isolated storage system for plugins
// Prevents cross-plugin access and enforces quotas

const STORAGE_PREFIX = 'audion_plugin_';
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB

export class PluginStorage {
    private pluginName: string;
    private quotaBytes: number;
    private cachedUsage: number | null = null; // Cache usage to avoid expensive recalculations
    private cacheTimestamp: number = 0;
    private readonly CACHE_TTL = 5000; // 5 seconds

    constructor(pluginName: string, quotaBytes: number = DEFAULT_QUOTA_BYTES) {
        this.pluginName = pluginName;
        this.quotaBytes = quotaBytes;
    }

    /**
     * Get namespaced key for this plugin
     */
    private getKey(key: string): string {
        return `${STORAGE_PREFIX}${this.pluginName}_${key}`;
    }

    /**
     * Get value from storage
     */
    get<T = any>(key: string): T | null {
        try {
            const storageKey = this.getKey(key);
            const value = localStorage.getItem(storageKey);
            return value ? JSON.parse(value) : null;
        } catch (err) {
            console.error(`[PluginStorage:${this.pluginName}] Failed to get ${key}:`, err);
            return null;
        }
    }

    /**
     * Set value in storage (with quota check)
     */
    set(key: string, value: any): boolean {
        try {
            const storageKey = this.getKey(key);
            const serialized = JSON.stringify(value);

            // Check quota before writing
            if (!this.checkQuota(storageKey, serialized)) {
                const usage = this.getUsedBytes();
                console.error(
                    `[PluginStorage:${this.pluginName}] Quota exceeded. ` +
                    `Used: ${usage} bytes, Limit: ${this.quotaBytes} bytes`
                );
                return false;
            }

            localStorage.setItem(storageKey, serialized);

            // Invalidate cache after write
            this.invalidateCache();

            return true;
        } catch (err) {
            console.error(`[PluginStorage:${this.pluginName}] Failed to set ${key}:`, err);
            return false;
        }
    }

    /**
     * Remove key from storage
     */
    remove(key: string): boolean {
        try {
            const storageKey = this.getKey(key);
            localStorage.removeItem(storageKey);
            this.invalidateCache();
            return true;
        } catch (err) {
            console.error(`[PluginStorage:${this.pluginName}] Failed to remove ${key}:`, err);
            return false;
        }
    }

    /**
     * Clear all storage for this plugin
     * Returns number of keys removed
     */
    async clear(): Promise<number> {
        const prefix = `${STORAGE_PREFIX}${this.pluginName}_`;
        const keysToRemove: string[] = [];

        // Find all keys for this plugin
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keysToRemove.push(key);
            }
        }

        // Remove them
        let removed = 0;
        keysToRemove.forEach(key => {
            try {
                localStorage.removeItem(key);
                removed++;
            } catch (err) {
                console.error(`[PluginStorage:${this.pluginName}] Failed to remove key ${key}:`, err);
            }
        });

        // Invalidate cache
        this.invalidateCache();

        console.log(`[PluginStorage:${this.pluginName}] Cleared ${removed}/${keysToRemove.length} items`);
        return removed;
    }

    /**
     * Get all keys for this plugin
     */
    keys(): string[] {
        const prefix = `${STORAGE_PREFIX}${this.pluginName}_`;
        const keys: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                // Remove prefix to get user-facing key
                keys.push(key.substring(prefix.length));
            }
        }

        return keys;
    }

    /**
     * Check if a key exists
     */
    has(key: string): boolean {
        const storageKey = this.getKey(key);
        return localStorage.getItem(storageKey) !== null;
    }

    /**
     * Get total bytes used by this plugin (with caching)
     */
    getUsedBytes(): number {
        const now = Date.now();

        // Return cached value if still valid
        if (this.cachedUsage !== null && (now - this.cacheTimestamp) < this.CACHE_TTL) {
            return this.cachedUsage;
        }

        // Recalculate
        const prefix = `${STORAGE_PREFIX}${this.pluginName}_`;
        let total = 0;

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                const value = localStorage.getItem(key);
                if (value) {
                    // Calculate size (key + value in UTF-16, so 2 bytes per char)
                    total += (key.length + value.length) * 2;
                }
            }
        }

        // Cache the result
        this.cachedUsage = total;
        this.cacheTimestamp = now;

        return total;
    }

    /**
     * Invalidate usage cache
     */
    private invalidateCache(): void {
        this.cachedUsage = null;
        this.cacheTimestamp = 0;
    }

    /**
     * Check if writing new value would exceed quota
     */
    private checkQuota(storageKey: string, newValue: string): boolean {
        const existingValue = localStorage.getItem(storageKey);
        const existingSize = existingValue ? (storageKey.length + existingValue.length) * 2 : 0;
        const newSize = (storageKey.length + newValue.length) * 2;
        const currentUsed = this.getUsedBytes();
        const delta = newSize - existingSize;

        return (currentUsed + delta) <= this.quotaBytes;
    }

    /**
     * Get quota information
     */
    getQuotaInfo(): { used: number; total: number; available: number; percentUsed: number } {
        const used = this.getUsedBytes();
        const available = Math.max(0, this.quotaBytes - used);
        const percentUsed = (used / this.quotaBytes) * 100;

        return { used, total: this.quotaBytes, available, percentUsed };
    }

    /**
     * Batch set multiple keys (more efficient than multiple set() calls)
     */
    setBatch(entries: Record<string, any>): { success: number; failed: number } {
        let success = 0;
        let failed = 0;

        Object.entries(entries).forEach(([key, value]) => {
            if (this.set(key, value)) {
                success++;
            } else {
                failed++;
            }
        });

        return { success, failed };
    }

    /**
     * Batch get multiple keys
     */
    getBatch<T = any>(keys: string[]): Record<string, T | null> {
        const result: Record<string, T | null> = {};

        keys.forEach(key => {
            result[key] = this.get<T>(key);
        });

        return result;
    }

    /**
     * Export all data for this plugin (for backup/migration)
     */
    exportData(): Record<string, any> {
        const data: Record<string, any> = {};
        const keys = this.keys();

        keys.forEach(key => {
            data[key] = this.get(key);
        });

        return data;
    }

    /**
     * Import data into storage
     * WARNING: This REPLACES all existing data by default
     * @param data - Data to import
     * @param replace - If true (default), clears all existing data first. If false, merges with existing data.
     */
    async importData(data: Record<string, any>, replace = true): Promise<{ success: number; failed: number }> {
        if (replace) {
            // Clear existing data first
            await this.clear();
        }

        // Import new data
        return this.setBatch(data);
    }
}
