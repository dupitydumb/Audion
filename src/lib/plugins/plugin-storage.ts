// Isolated storage system for plugins
// Prevents cross-plugin access and enforces quotas

const STORAGE_PREFIX = 'audion_plugin_';
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB

export class PluginStorage {
    private pluginName: string;
    private quotaBytes: number;

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
                console.error(
                    `[PluginStorage:${this.pluginName}] Quota exceeded. ` +
                    `Used: ${this.getUsedBytes()} bytes, Limit: ${this.quotaBytes} bytes`
                );
                return false;
            }

            localStorage.setItem(storageKey, serialized);
            return true;
        } catch (err) {
            console.error(`[PluginStorage:${this.pluginName}] Failed to set ${key}:`, err);
            return false;
        }
    }

    /**
     * Remove key from storage
     */
    remove(key: string): void {
        const storageKey = this.getKey(key);
        localStorage.removeItem(storageKey);
    }

    /**
     * Clear all storage for this plugin
     */
    clear(): void {
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
        keysToRemove.forEach(key => localStorage.removeItem(key));
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
     * Get total bytes used by this plugin
     */
    getUsedBytes(): number {
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

        return total;
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
}
