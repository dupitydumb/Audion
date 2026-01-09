// Type-safe event emitter for plugin runtime
// Provides pub/sub pattern for plugin events

export type EventListener<T = any> = (data: T) => void;

export interface PluginEvents {
    trackChange: { track: any | null; previousTrack: any | null };
    playStateChange: { isPlaying: boolean };
    timeUpdate: { currentTime: number; duration: number };
    queueChange: { queue: any[]; index: number };
}

export class EventEmitter<EventMap extends Record<string, any>> {
    private listeners: Map<keyof EventMap, Set<EventListener<any>>> = new Map();
    private maxListeners = 10;

    /**
     * Subscribe to an event
     */
    on<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }

        const eventListeners = this.listeners.get(event)!;
        eventListeners.add(listener);

        // Memory leak warning
        if (eventListeners.size > this.maxListeners) {
            console.warn(
                `[EventEmitter] Warning: ${String(event)} has ${eventListeners.size} listeners. ` +
                `Possible memory leak detected. Max: ${this.maxListeners}`
            );
        }
    }

    /**
     * Unsubscribe from an event
     */
    off<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.delete(listener);
            if (eventListeners.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Subscribe to an event once (auto-unsubscribe after first emission)
     */
    once<K extends keyof EventMap>(event: K, listener: EventListener<EventMap[K]>): void {
        const onceWrapper = (data: EventMap[K]) => {
            this.off(event, onceWrapper);
            listener(data);
        };
        this.on(event, onceWrapper);
    }

    /**
     * Emit an event to all subscribers
     */
    emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach(listener => {
                try {
                    listener(data);
                } catch (err) {
                    console.error(`[EventEmitter] Error in ${String(event)} listener:`, err);
                }
            });
        }
    }

    /**
     * Remove all listeners for an event, or all events if no event specified
     */
    removeAllListeners<K extends keyof EventMap>(event?: K): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Get listener count for an event
     */
    listenerCount<K extends keyof EventMap>(event: K): number {
        return this.listeners.get(event)?.size ?? 0;
    }

    /**
     * Set max listeners before warning
     */
    setMaxListeners(n: number): void {
        this.maxListeners = n;
    }
}
